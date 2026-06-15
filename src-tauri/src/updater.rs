//! Self-update by checking GitHub Releases for a newer `.deb` and installing it
//! via PolicyKit (`pkexec apt-get install`). Mirrors the Clippy updater — the
//! Tauri updater can't replace an apt-installed `.deb`, so we do it ourselves.
//! Linux/.deb only; on other platforms `check` just reports "up to date".

use serde::Serialize;

const REPO: &str = "davidboulay/CosmiCal";
const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct UpdateInfo {
    /// The running version, e.g. "0.2.10".
    pub current: String,
    /// Latest release version (no leading 'v'); None if the check failed.
    pub latest: Option<String>,
    pub update_available: bool,
    /// Release page to open in a browser.
    pub url: String,
    /// Direct `.deb` download URL, if the latest release ships one.
    pub deb_url: Option<String>,
    /// Human-readable reason the check failed, if any.
    pub error: Option<String>,
}

fn releases_page() -> String {
    format!("https://github.com/{REPO}/releases/latest")
}

/// Lenient numeric version parse: "v0.2.10-rc" -> [0, 2, 10].
fn parse_version(v: &str) -> Vec<u32> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

fn err_result(error: impl Into<String>) -> UpdateInfo {
    UpdateInfo {
        current: CURRENT.to_string(),
        latest: None,
        update_available: false,
        url: releases_page(),
        deb_url: None,
        error: Some(error.into()),
    }
}

/// Query GitHub for the latest release and compare it to the running version.
/// Never errors — failures come back in `UpdateInfo.error`.
pub async fn check() -> UpdateInfo {
    let api = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let res = reqwest::Client::new()
        .get(&api)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", format!("CosmiCal/{CURRENT}"))
        .send()
        .await;

    let resp = match res {
        Ok(r) => r,
        Err(_) => return err_result("No network connection"),
    };
    if !resp.status().is_success() {
        return err_result(format!("GitHub returned {}", resp.status().as_u16()));
    }
    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(_) => return err_result("Unexpected response"),
    };

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if tag.is_empty() {
        return err_result("No releases found");
    }
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    let url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(releases_page);
    let deb_url = json
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|a| {
                let name = a.get("name").and_then(|n| n.as_str())?;
                if name.ends_with(".deb") {
                    a.get("browser_download_url")
                        .and_then(|u| u.as_str())
                        .map(String::from)
                } else {
                    None
                }
            })
        });

    UpdateInfo {
        current: CURRENT.to_string(),
        update_available: is_newer(&latest, CURRENT),
        latest: Some(latest),
        url,
        deb_url,
        error: None,
    }
}

/// Relaunch the app after an update installed a new binary.
///
/// We deliberately do **not** use `AppHandle::restart()`: it spawns the new
/// process while this one is still exiting and still holds the single-instance
/// abstract socket (see `single_instance.rs`). The new process then sees the
/// name in use, sends a `focus` signal, and exits — leaving nothing running,
/// which is exactly the "had to relaunch manually" symptom.
///
/// Instead we spawn a detached helper that sleeps ~1s — long enough for THIS
/// process to exit and the kernel to release the abstract name — then `exec`s
/// the new binary, which now binds the socket cleanly. The caller exits right
/// after. The helper runs in its own process group so the parent's exit can't
/// take it down.
pub fn relaunch_for_update() {
    let Ok(exe) = std::env::current_exe() else {
        log::warn!("update: current_exe() failed; cannot relaunch");
        return;
    };
    // apt replaced the binary file, so /proc/self/exe (what current_exe reads)
    // now points at the old, unlinked inode and the path comes back with a
    // literal " (deleted)" suffix. Exec'ing that fails. Strip it — the new
    // binary lives at the same path (e.g. /usr/bin/rencal).
    let exe_str = exe.to_string_lossy();
    let exe_path = exe_str.strip_suffix(" (deleted)").unwrap_or(&exe_str).to_string();
    let mut cmd = std::process::Command::new("sh");
    // `$0` carries the exe path as a positional arg, so paths with spaces or
    // shell metacharacters pass through verbatim (no string interpolation).
    cmd.arg("-c").arg("sleep 1; exec \"$0\"").arg(&exe_path);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    match cmd.spawn() {
        Ok(_) => log::info!("update: relaunch helper spawned for {exe_path}"),
        Err(e) => log::warn!("update: could not spawn relaunch helper: {e}"),
    }
}

/// Download the release `.deb` and install it with apt via PolicyKit. `pkexec`
/// shows the system password dialog. Returns Ok once apt exits 0.
pub async fn download_and_install(deb_url: String) -> Result<(), String> {
    let bytes = reqwest::Client::new()
        .get(&deb_url)
        .header("User-Agent", format!("CosmiCal/{CURRENT}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let path = std::env::temp_dir().join("cosmical-update.deb");
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not save update: {e}"))?;
    log::info!("update: downloaded {} bytes to {}", bytes.len(), path.display());

    let output = tokio::process::Command::new("pkexec")
        .arg("apt-get")
        .arg("install")
        .arg("-y")
        .arg("--allow-downgrades")
        .arg(&path)
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "pkexec (PolicyKit) is not available".to_string()
            } else {
                e.to_string()
            }
        })?;

    let _ = std::fs::remove_file(&path);

    if output.status.success() {
        log::info!("update: installed successfully");
        return Ok(());
    }
    // 126/127: PolicyKit auth dismissed/cancelled.
    if matches!(output.status.code(), Some(126) | Some(127)) {
        return Err("Authentication cancelled".to_string());
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim();
    Err(detail
        .lines()
        .last()
        .map(str::to_string)
        .unwrap_or_else(|| format!("apt-get exited with {:?}", output.status.code())))
}
