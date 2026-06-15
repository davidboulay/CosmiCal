/// Returns true when the window should use OS-native decorations.
///
/// - macOS uses the overlay titlebar configured in `tauri.macos.conf.json`.
/// - Linux only decorates on known stacking WMs (GNOME, KDE, etc.); tiling
///   WMs like Hyprland/sway/i3 stay decoration-free as the app expects.
/// - Windows always decorates.
pub fn needs_native_decorations() -> bool {
    #[cfg(target_os = "windows")]
    return true;

    #[cfg(target_os = "macos")]
    return false;

    #[cfg(target_os = "linux")]
    {
        let Ok(desktop) = std::env::var("XDG_CURRENT_DESKTOP") else {
            return false;
        };
        const STACKING_WMS: &[&str] = &[
            "COSMIC",
            "GNOME",
            "KDE",
            "XFCE",
            "X-CINNAMON",
            "CINNAMON",
            "MATE",
            "LXQT",
            "LXDE",
            "PANTHEON",
            "BUDGIE",
            "UNITY",
            "DEEPIN",
        ];
        let desktop_upper = desktop.to_uppercase();
        return STACKING_WMS.iter().any(|wm| desktop_upper.contains(wm));
    }

    #[allow(unreachable_code)]
    false
}

#[taurpc::procedures(path = "platform", export_to = "../src/rpc/bindings.ts")]
pub trait PlatformApi {
    async fn needs_native_decorations() -> bool;
    async fn set_tray_pending(pending: bool);
    async fn check_for_update() -> crate::updater::UpdateInfo;
    async fn install_update(deb_url: String) -> Result<(), String>;
    // Relaunch the app (used after an update installs the new binary).
    async fn restart_app<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>);
}

#[derive(Clone)]
pub struct PlatformApiImpl;

#[taurpc::resolvers]
impl PlatformApi for PlatformApiImpl {
    async fn needs_native_decorations(self) -> bool {
        needs_native_decorations()
    }
    async fn set_tray_pending(self, pending: bool) {
        crate::tray::set_pending(pending);
    }
    async fn check_for_update(self) -> crate::updater::UpdateInfo {
        crate::updater::check().await
    }
    async fn install_update(self, deb_url: String) -> Result<(), String> {
        crate::updater::download_and_install(deb_url).await
    }
    async fn restart_app<R: tauri::Runtime>(self, app_handle: tauri::AppHandle<R>) {
        // Spawn the race-free relauncher (waits for our single-instance socket to
        // free), then exit. NOT app_handle.restart() — that races the guard and
        // the new process exits as a "duplicate", leaving nothing running.
        crate::updater::relaunch_for_update();
        app_handle.exit(0);
    }
}
