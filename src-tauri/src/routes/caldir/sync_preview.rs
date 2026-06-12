use super::helpers::load_caldir;
use super::sync_progress::emit_progress;
use super::types::SyncPreview;
use crate::routes::TauResult;
use caldir_core::{DateRange, EventChange};
use tauri::{AppHandle, Runtime};

pub(super) async fn handler<R: Runtime>(app: AppHandle<R>) -> TauResult<Vec<SyncPreview>> {
    let caldir = load_caldir()?;
    let range = DateRange::default_sync_window();
    let mut previews = Vec::new();

    for connection in caldir.connections() {
        let connection = connection.map_err(|e| e.to_string())?;
        let slug = connection
            .local()
            .slug()
            .ok_or_else(|| "calendar missing slug".to_string())?
            .to_string();

        log::info!("sync check [{slug}]: checking for changes");
        emit_progress(&app, &slug, "checking", None, None, None);

        let diff = match connection.diff(&range).await {
            Ok(d) => d,
            Err(e) => {
                let msg = e.to_string();
                log::warn!("sync check [{slug}]: error: {msg}");
                emit_progress(&app, &slug, "error", None, None, Some(&msg));
                return Err(format!("[{}] {}", slug, msg));
            }
        };

        let to_pull = diff.incoming().len() as u32;
        let to_push = diff.outgoing().len() as u32;
        let to_push_delete_count = diff
            .outgoing()
            .iter()
            .filter(|c| matches!(c, EventChange::Delete(_)))
            .count() as u32;

        log::info!("sync check [{slug}]: {to_pull} to pull, {to_push} to push");
        emit_progress(&app, &slug, "checked", Some(to_pull), Some(to_push), None);

        previews.push(SyncPreview {
            calendar_slug: slug,
            to_push_count: to_push,
            to_push_delete_count,
            to_pull_count: to_pull,
        });
    }

    Ok(previews)
}
