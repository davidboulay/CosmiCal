//! renCal-specific user preferences at ~/.config/rencal/config.toml.
//!
//! Lives in its own workspace crate so both the Tauri app and the standalone
//! `rencal-notifierd` daemon (via `reminder-core`) can read/write the same
//! file without dragging Tauri/taurpc into a long-lived systemd service.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

fn default_theme() -> String {
    "cosmic-light".to_string()
}

fn default_notifications_enabled() -> bool {
    true
}

fn default_auto_sync_enabled() -> bool {
    true
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RencalConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_notifications_enabled")]
    pub notifications_enabled: bool,
    #[serde(default = "default_auto_sync_enabled")]
    pub auto_sync_enabled: bool,
    /// When started at login (launched with `--minimized`), start hidden to the
    /// tray instead of opening the window. Only affects autostart launches.
    #[serde(default = "default_true")]
    pub start_minimized: bool,
    /// Google OAuth client (Desktop) used for creating Google Meet links via the
    /// Calendar REST API. The user supplies their own client; the refresh token
    /// is obtained via a one-time consent. All optional (feature is off until set).
    #[serde(default)]
    pub google_meet_client_id: Option<String>,
    #[serde(default)]
    pub google_meet_client_secret: Option<String>,
    #[serde(default)]
    pub google_meet_refresh_token: Option<String>,
    /// Per-feature toggles for the connected Google account (both on by default).
    #[serde(default = "default_true")]
    pub google_meet_enabled: bool,
    #[serde(default = "default_true")]
    pub google_contacts_enabled: bool,
}

impl Default for RencalConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            notifications_enabled: default_notifications_enabled(),
            auto_sync_enabled: default_auto_sync_enabled(),
            start_minimized: true,
            google_meet_client_id: None,
            google_meet_client_secret: None,
            google_meet_refresh_token: None,
            google_meet_enabled: true,
            google_contacts_enabled: true,
        }
    }
}

impl RencalConfig {
    pub fn config_path() -> Result<PathBuf, String> {
        let dir = dirs::config_dir()
            .ok_or_else(|| "Could not resolve user config directory".to_string())?
            .join("rencal");
        Ok(dir.join("config.toml"))
    }

    pub fn exists() -> bool {
        Self::config_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// Infallible by design: missing or malformed file falls back to defaults
    /// so callers don't need an error path on every read.
    pub fn load() -> Self {
        let Ok(path) = Self::config_path() else {
            return Self::default();
        };
        let Ok(contents) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        toml::from_str(&contents).unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create config directory: {e}"))?;
        }
        let contents =
            toml::to_string_pretty(self).map_err(|e| format!("Could not serialize config: {e}"))?;
        std::fs::write(&path, contents).map_err(|e| format!("Could not write config file: {e}"))
    }
}
