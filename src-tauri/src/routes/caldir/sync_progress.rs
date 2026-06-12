//! Per-calendar progress events emitted while a sync/reload runs, so the UI's
//! reload status bubble can show what each account is doing in real time.

use serde_json::json;
use tauri::{AppHandle, Emitter, Runtime};

/// Frontend event carrying one calendar's current sync phase.
pub const SYNC_PROGRESS_EVENT: &str = "sync-progress";

/// Emit a progress update for a single calendar.
///
/// `phase` is one of: `checking`, `checked`, `pulling`, `pushing`, `done`,
/// `error`. `to_pull`/`to_push` are included when known; `detail` carries an
/// error message for the `error` phase.
pub fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    slug: &str,
    phase: &str,
    to_pull: Option<u32>,
    to_push: Option<u32>,
    detail: Option<&str>,
) {
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        json!({
            "calendar_slug": slug,
            "phase": phase,
            "to_pull": to_pull,
            "to_push": to_push,
            "detail": detail,
        }),
    );
}
