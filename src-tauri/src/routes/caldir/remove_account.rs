use super::helpers::load_caldir;
use crate::event_cache::EVENT_CACHE;
use crate::routes::TauResult;
use std::collections::HashSet;

/// Remove a connected account: delete its calendar directories and clear the
/// provider session so re-adding the account prompts for credentials again
/// (which lets the Google Meet capture pick them up).
pub(super) async fn handler(account: String) -> TauResult<()> {
    let caldir = load_caldir()?;

    let mut providers: HashSet<String> = HashSet::new();
    let mut removed = 0;

    for cal_result in caldir.calendars() {
        let cal = match cal_result {
            Ok(c) => c,
            Err(_) => continue,
        };
        let rc = cal.remote_config();
        let matches = rc
            .and_then(|r| r.account_identifier())
            .map(|id| id == account)
            .unwrap_or(false);
        if !matches {
            continue;
        }

        if let Some(slug) = cal.slug() {
            EVENT_CACHE.invalidate(slug);
        }
        if let Some(r) = rc {
            providers.insert(r.provider_slug().to_string());
        }
        std::fs::remove_dir_all(cal.path())
            .map_err(|e| format!("Failed to remove calendar: {e}"))?;
        removed += 1;
    }

    if removed == 0 {
        return Err("No calendars found for that account".to_string());
    }

    // Clear the provider session(s) so a fresh connect re-asks for credentials.
    if let Some(cfg_dir) = dirs::config_dir() {
        for provider in providers {
            let session = cfg_dir
                .join("caldir")
                .join("providers")
                .join(&provider)
                .join("session");
            let _ = std::fs::remove_dir_all(&session);
        }
    }

    Ok(())
}
