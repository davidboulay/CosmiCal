mod caldir_watcher;
mod event_cache;
mod google_meet;
#[cfg(target_os = "linux")]
mod linux_reminders;
mod notifications;
mod oauth;
mod omarchy;
mod routes;
#[cfg(target_os = "linux")]
mod single_instance;
mod tray;

use routes::caldir::{CaldirApi, CaldirApiImpl};
use routes::config::{ConfigApi, ConfigApiImpl};
use routes::omarchy::{OmarchyApi, OmarchyApiImpl};
use routes::platform::{PlatformApi, PlatformApiImpl, needs_native_decorations};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{Emitter, Manager};
use taurpc::Router;

/// Frontend event fired when a reminder notification is clicked, carrying the
/// deep-link token "<startEpochMs>::<eventInstanceId>".
const OPEN_EVENT: &str = "open-event";

/// Parse `--open-event=<token>` from the process arguments, if present.
fn open_event_token() -> Option<String> {
    std::env::args()
        .find_map(|a| a.strip_prefix("--open-event=").map(str::to_string))
        .filter(|s| !s.is_empty())
}

const MIN_WINDOW_WIDTH: f64 = 300.0;
const MIN_WINDOW_HEIGHT: f64 = 600.0;

static BUNDLED_PROVIDERS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Directory of the providers bundled with this build, resolved at startup.
pub fn bundled_providers_dir() -> Option<&'static Path> {
    BUNDLED_PROVIDERS_DIR.get().map(PathBuf::as_path)
}

/// Creates the taurpc router. Exposed for type generation.
pub fn create_router() -> Router<tauri::Wry> {
    Router::new()
        .merge(CaldirApiImpl.into_handler())
        .merge(OmarchyApiImpl.into_handler())
        .merge(PlatformApiImpl.into_handler())
        .merge(ConfigApiImpl.into_handler())
}

/// Resolve the bundled providers directory and remember it for `load_caldir`.
fn setup_bundled_providers(app: &tauri::App) {
    let providers_dir = if cfg!(debug_assertions) {
        // In dev mode, Tauri doesn't copy resources — use the build output directly.
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("providers")
    } else {
        app.path()
            .resolve("providers", tauri::path::BaseDirectory::Resource)
            .expect("failed to resolve bundled providers directory")
    };

    // Ensure bundled binaries are executable (unix only).
    #[cfg(unix)]
    if let Ok(entries) = std::fs::read_dir(&providers_dir) {
        use std::os::unix::fs::PermissionsExt;
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                let mut perms = metadata.permissions();
                perms.set_mode(perms.mode() | 0o111);
                let _ = std::fs::set_permissions(entry.path(), perms);
            }
        }
    }

    let _ = BUNDLED_PROVIDERS_DIR.set(providers_dir);
}

/// On a fresh install, default the calendar store to an app-owned data folder
/// (the platform per-user data dir, e.g. `~/.local/share/CosmiCal/calendars`)
/// instead of caldir's visible `~/caldir`. Runs only when caldir has never been
/// configured (no config file yet) — existing setups are left untouched, and
/// the location remains overridable in Settings → General.
fn init_default_data_dir() {
    let Some(config_dir) = dirs::config_dir() else {
        return;
    };
    // caldir writes its config here on first use; presence means an existing setup.
    if config_dir.join("caldir").join("config.toml").exists() {
        return;
    }
    let Some(data_dir) = dirs::data_dir() else {
        return;
    };
    let calendars_dir = data_dir.join("CosmiCal").join("calendars");
    if std::fs::create_dir_all(&calendars_dir).is_err() {
        return;
    }
    if let Ok(mut caldir) = caldir_core::Caldir::load() {
        let mut config = caldir.config().clone();
        config.set_data_dir(calendars_dir);
        let _ = caldir.save_config(config);
    }
}

fn spawn_reminder_loop_if_needed(app: &tauri::App) {
    #[cfg(target_os = "linux")]
    if !linux_reminders::should_run_in_process_reminders() {
        log::info!("rencal-notifierd is active — skipping in-process reminder loop");
        return;
    }

    tokio::spawn(notifications::run_reminder_loop(app.handle().clone()));
}

#[tokio::main]
pub async fn run() {
    // The native titlebar (drawn by the WM/compositor) follows the OS GTK theme
    // so the window chrome matches the user's system light/dark setting, like a
    // native COSMIC app. (We intentionally do NOT force GTK_THEME here.)

    // WebKitGTK's DMABUF renderer renders blurry/low-res content on a number of
    // Linux GPU/driver setups; disabling it makes the webview render crisply at
    // native resolution. Must be set before WebKitGTK initializes.
    #[cfg(target_os = "linux")]
    unsafe {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // Single-instance: on Linux we use a Unix socket because
    // `tauri-plugin-single-instance` panics under our runtime config (zbus
    // pulls in the tokio feature transitively from xdg-portal). On
    // macOS/Windows the plugin's native impl is fine.
    // If launched to open a specific event (from a notification click), forward
    // it to the running instance; otherwise just "focus".
    #[cfg(target_os = "linux")]
    let pending_open = open_event_token();
    #[cfg(target_os = "linux")]
    let mut instance_guard = {
        let message = match &pending_open {
            Some(token) => format!("open\t{token}"),
            None => "focus".to_string(),
        };
        match single_instance::try_acquire_or_signal(&message) {
            Some(g) => g,
            None => return, // existing instance was signaled; we exit.
        }
    };

    let router = create_router();

    let builder = tauri::Builder::default();

    #[cfg(not(target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stderr,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .max_file_size(1_000_000)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Login launches pass --minimized; whether we actually start hidden
            // is gated by the `start_minimized` setting (see setup below).
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // Pick an app-owned calendar store on first run (before any sync).
            init_default_data_dir();

            // Bundle default providers (google, icloud, caldav...)
            setup_bundled_providers(app);

            // Enable systemd notifications:
            #[cfg(target_os = "linux")]
            {
                linux_reminders::enable_notifierd_if_needed();
                let focus_handle = app.handle().clone();
                let open_handle = app.handle().clone();
                let focus_window = move |h: &tauri::AppHandle| {
                    if let Some(window) = h.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                };
                let focus_window2 = focus_window.clone();
                single_instance::spawn_listener(
                    &mut instance_guard,
                    move || focus_window(&focus_handle),
                    move |token| {
                        focus_window2(&open_handle);
                        let _ = open_handle.emit(OPEN_EVENT, token);
                    },
                );

                // Cold start via a notification click: emit once the frontend is up.
                if let Some(token) = pending_open.clone() {
                    let h = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1200));
                        let _ = h.emit(OPEN_EVENT, token);
                    });
                }
            }

            spawn_reminder_loop_if_needed(app);

            // Handle changing Omarchy theme:
            tokio::spawn(omarchy::run_watcher(app.handle().clone()));

            // Handle caldir file changes:
            tokio::spawn(caldir_watcher::run_watcher(app.handle().clone()));

            // System-tray icon showing today's date + a pending-notification dot.
            {
                use chrono::Datelike;
                use tauri::menu::{Menu, MenuItem};

                let show_main = |app: &tauri::AppHandle| {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                };

                // AppIndicator (Linux) only shows an icon that has a menu, so we
                // always attach one (Open / Quit).
                let open_item = MenuItem::with_id(app, "tray_open", "Open CosmiCal", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

                let initial = tray::render_day_icon(chrono::Local::now().day(), false);
                match tauri::tray::TrayIconBuilder::with_id(tray::TRAY_ID)
                    .icon(initial)
                    .icon_as_template(false)
                    .tooltip("CosmiCal")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id().as_ref() {
                        "tray_open" => show_main(app),
                        "tray_quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(w) = tray.app_handle().get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)
                {
                    Ok(_) => log::info!("Tray icon created"),
                    Err(e) => log::error!("Failed to create tray icon: {e}"),
                }
                tray::init(&app.handle());
                // Keep the day number current (also rolls over at midnight).
                let h = app.handle().clone();
                tokio::spawn(async move {
                    let _ = h; // handle kept alive via tray::APP
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        tray::refresh();
                    }
                });
            }

            // Start hidden to the tray only when launched at login (--minimized)
            // and the user left "Start minimized" on. Other launches show the
            // window. The window is created hidden (visible:false) to avoid a
            // flash before we decide.
            let minimized_start = std::env::args().any(|a| a == "--minimized")
                && rencal_config::RencalConfig::load().start_minimized;

            if let Some(window) = app.get_webview_window("main") {
                if needs_native_decorations() {
                    let _ = window.set_decorations(true);
                    // Let the titlebar/chrome follow the OS light/dark setting.
                    let _ = window.set_theme(None);
                }
                let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                    MIN_WINDOW_WIDTH,
                    MIN_WINDOW_HEIGHT,
                )));
                if !minimized_start {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the main window hides it instead of quitting, so the
                // app keeps running in the background: the tray icon stays and
                // reminder notifications keep firing. Use the tray's "Quit"
                // item to exit fully. (Other windows, e.g. Settings, close
                // normally.)
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(router.into_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = _event
            {
                if !has_visible_windows {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
