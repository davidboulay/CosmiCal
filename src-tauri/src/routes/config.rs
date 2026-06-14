use rencal_config::RencalConfig;
use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::routes::TauResult;

// `get_theme` returns `Some(theme)` if the config file exists, `None` if it
// has never been written. The frontend uses the `None` case to migrate a
// pre-existing `localStorage["theme"]` value up to TOML on first run.
#[taurpc::procedures(path = "config", export_to = "../src/rpc/bindings.ts")]
pub trait ConfigApi {
    async fn get_theme() -> TauResult<Option<String>>;
    async fn set_theme(theme: String) -> TauResult<()>;
    async fn get_notifications_enabled() -> TauResult<bool>;
    async fn set_notifications_enabled(enabled: bool) -> TauResult<()>;
    async fn get_auto_sync_enabled() -> TauResult<bool>;
    async fn set_auto_sync_enabled(enabled: bool) -> TauResult<()>;
    async fn get_start_at_login<R: Runtime>(app_handle: AppHandle<R>) -> TauResult<bool>;
    async fn set_start_at_login<R: Runtime>(
        app_handle: AppHandle<R>,
        enabled: bool,
    ) -> TauResult<()>;
    async fn get_start_minimized() -> TauResult<bool>;
    async fn set_start_minimized(enabled: bool) -> TauResult<()>;
}

#[derive(Clone)]
pub struct ConfigApiImpl;

#[taurpc::resolvers]
impl ConfigApi for ConfigApiImpl {
    async fn get_theme(self) -> TauResult<Option<String>> {
        if !RencalConfig::exists() {
            return Ok(None);
        }
        Ok(Some(RencalConfig::load().theme))
    }

    async fn set_theme(self, theme: String) -> TauResult<()> {
        let mut config = RencalConfig::load();
        config.theme = theme;
        config.save()
    }

    async fn get_notifications_enabled(self) -> TauResult<bool> {
        Ok(RencalConfig::load().notifications_enabled)
    }

    async fn set_notifications_enabled(self, enabled: bool) -> TauResult<()> {
        let mut config = RencalConfig::load();
        config.notifications_enabled = enabled;
        config.save()
    }

    async fn get_auto_sync_enabled(self) -> TauResult<bool> {
        Ok(RencalConfig::load().auto_sync_enabled)
    }

    async fn set_auto_sync_enabled(self, enabled: bool) -> TauResult<()> {
        let mut config = RencalConfig::load();
        config.auto_sync_enabled = enabled;
        config.save()
    }

    // Start-at-login is backed by the OS autostart entry itself (on Linux, an
    // XDG `~/.config/autostart/*.desktop` file), so its presence is the source
    // of truth — no separate value is stored in the TOML config.
    async fn get_start_at_login<R: Runtime>(self, app_handle: AppHandle<R>) -> TauResult<bool> {
        app_handle
            .autolaunch()
            .is_enabled()
            .map_err(|e| e.to_string())
    }

    async fn set_start_at_login<R: Runtime>(
        self,
        app_handle: AppHandle<R>,
        enabled: bool,
    ) -> TauResult<()> {
        let manager = app_handle.autolaunch();
        if enabled {
            manager.enable().map_err(|e| e.to_string())
        } else {
            manager.disable().map_err(|e| e.to_string())
        }
    }

    async fn get_start_minimized(self) -> TauResult<bool> {
        Ok(RencalConfig::load().start_minimized)
    }

    async fn set_start_minimized(self, enabled: bool) -> TauResult<()> {
        let mut config = RencalConfig::load();
        config.start_minimized = enabled;
        config.save()
    }
}
