use super::helpers::load_caldir;
use super::sync_progress::emit_progress;
use crate::event_cache::EVENT_CACHE;
use crate::routes::TauResult;
use caldir_core::{DateRange, EventChange};
use tauri::{AppHandle, Runtime};

/// Number of pending push deletions that triggers the mass-delete safeguard.
/// Mirrors `caldir-cli`'s `guards::MASS_DELETE_THRESHOLD`.
const MASS_DELETE_THRESHOLD: u32 = 10;

/// Full sync across every calendar.
pub(super) async fn handler<R: Runtime>(
    app: AppHandle<R>,
    allow_mass_delete: Vec<String>,
) -> TauResult<()> {
    run_sync(&app, &allow_mass_delete, None).await
}

/// Targeted sync of a single calendar — used after a local mutation (create,
/// edit, delete, RSVP) so we push/pull just the affected calendar instead of
/// looping every account.
pub(super) async fn handler_one<R: Runtime>(
    app: AppHandle<R>,
    calendar_slug: String,
) -> TauResult<()> {
    run_sync(&app, &[], Some(&calendar_slug)).await
}

async fn run_sync<R: Runtime>(
    app: &AppHandle<R>,
    allow_mass_delete: &[String],
    only: Option<&str>,
) -> TauResult<()> {
    let caldir = load_caldir()?;
    let range = DateRange::default_sync_window();

    for connection in caldir.connections() {
        let mut connection = connection.map_err(|e| e.to_string())?;
        let slug = connection
            .local()
            .slug()
            .ok_or_else(|| "calendar missing slug".to_string())?
            .to_string();

        // Targeted sync: skip every calendar but the requested one.
        if only.is_some_and(|o| o != slug) {
            continue;
        }

        log::info!("sync [{slug}]: checking for changes");
        emit_progress(app, &slug, "checking", None, None, None);

        let diff = match connection.diff(&range).await {
            Ok(d) => d,
            Err(e) => {
                let msg = e.to_string();
                log::warn!("sync [{slug}]: error: {msg}");
                emit_progress(app, &slug, "error", None, None, Some(&msg));
                return Err(format!("[{}] {}", slug, msg));
            }
        };

        let to_pull = diff.incoming().len() as u32;
        let to_push = diff.outgoing().len() as u32;

        if to_pull > 0 {
            log::info!("sync [{slug}]: pulling {to_pull}");
            emit_progress(app, &slug, "pulling", Some(to_pull), Some(to_push), None);
        }

        if let Err(e) = connection.apply_incoming_diff(&diff) {
            let msg = e.to_string();
            log::warn!("sync [{slug}]: pull failed: {msg}");
            emit_progress(app, &slug, "error", None, None, Some(&msg));
            return Err(format!("[{}] {}", slug, msg));
        }
        EVENT_CACHE.invalidate(&slug);

        if connection.read_only() {
            log::info!("sync [{slug}]: done (read-only, pulled {to_pull})");
            emit_progress(app, &slug, "done", Some(to_pull), Some(0), None);
            continue;
        }

        let push_delete_count = diff
            .outgoing()
            .iter()
            .filter(|c| matches!(c, EventChange::Delete(_)))
            .count() as u32;

        let mass_delete_blocked =
            push_delete_count >= MASS_DELETE_THRESHOLD && !allow_mass_delete.contains(&slug);

        if mass_delete_blocked {
            log::warn!("sync [{slug}]: {push_delete_count} deletions held for confirmation");
            emit_progress(app, &slug, "done", Some(to_pull), Some(0), None);
            continue;
        }

        if to_push > 0 {
            log::info!("sync [{slug}]: pushing {to_push}");
            emit_progress(app, &slug, "pushing", Some(to_pull), Some(to_push), None);
        }

        if let Err(e) = connection.apply_outgoing_diff(&diff).await {
            let msg = e.to_string();
            log::warn!("sync [{slug}]: push failed: {msg}");
            emit_progress(app, &slug, "error", None, None, Some(&msg));
            return Err(format!("[{}] {}", slug, msg));
        }
        EVENT_CACHE.invalidate(&slug);

        log::info!("sync [{slug}]: done ({to_pull} pulled, {to_push} pushed)");
        emit_progress(app, &slug, "done", Some(to_pull), Some(to_push), None);
    }

    Ok(())
}
