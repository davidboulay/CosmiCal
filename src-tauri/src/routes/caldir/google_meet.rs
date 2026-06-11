use super::helpers::{calendar_self_email, load_caldir};
use super::types::{CreateMeetEventInput, GoogleContact, GoogleMeetStatus};
use crate::google_meet;
use crate::routes::TauResult;
use rencal_config::RencalConfig;
use serde_json::{Value, json};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

/// Kept for binding compatibility. The turnkey flow uses the baked-in public
/// client + OAuth proxy, so no per-user credentials are needed; this just stores
/// an optional override that the rest of the flow currently ignores.
pub(super) async fn set_credentials(client_id: String, client_secret: String) -> TauResult<()> {
    let mut cfg = RencalConfig::load();
    cfg.google_meet_client_id = Some(client_id.trim().to_string());
    cfg.google_meet_client_secret = Some(client_secret.trim().to_string());
    cfg.save()
}

pub(super) async fn status() -> TauResult<GoogleMeetStatus> {
    let cfg = RencalConfig::load();
    Ok(GoogleMeetStatus {
        // Always configured: the public client id + proxy URL are baked in.
        configured: true,
        connected: cfg.google_meet_refresh_token.is_some(),
        meet_enabled: cfg.google_meet_enabled,
        contacts_enabled: cfg.google_contacts_enabled,
    })
}

/// Enable/disable individual Google features for the connected account.
pub(super) async fn set_features(meet_enabled: bool, contacts_enabled: bool) -> TauResult<()> {
    let mut cfg = RencalConfig::load();
    cfg.google_meet_enabled = meet_enabled;
    cfg.google_contacts_enabled = contacts_enabled;
    cfg.save()
}

/// One-time consent: open Google's OAuth page (PKCE), capture the code on the
/// loopback, exchange it through the proxy for a refresh token, and persist it.
pub(super) async fn connect<R: Runtime>(app: AppHandle<R>) -> TauResult<()> {
    let listener = crate::oauth::server::create_localhost_listener(0)
        .map_err(|e| format!("Failed to start callback server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let pkce = google_meet::generate_pkce();

    let auth_url = google_meet::build_auth_url(&redirect_uri, &state, &pkce.challenge)
        .map_err(|e| e.to_string())?;
    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    let callback = crate::oauth::server::handle_oauth_callback(listener, port)
        .await
        .map_err(|e| format!("OAuth callback failed: {e}"))?;
    if callback.state != state {
        return Err("OAuth state mismatch".to_string());
    }

    let refresh = google_meet::exchange_code(&callback.code, &pkce.verifier, &redirect_uri)
        .await
        .map_err(|e| e.to_string())?;

    let mut cfg = RencalConfig::load();
    cfg.google_meet_refresh_token = Some(refresh.clone());
    cfg.save()?;

    // Prime the People API search cache so invitee autocomplete returns results
    // promptly on first use. Best-effort — never block connection on it.
    if let Ok(token) = google_meet::access_token(&refresh).await {
        google_meet::warmup_contacts(&token).await;
    }
    Ok(())
}

/// Search the connected Google account's contacts for invitee autocomplete.
/// Returns an empty list (rather than erroring) when not connected or the
/// contacts scope hasn't been granted, so the UI silently falls back to
/// event-mined suggestions.
pub(super) async fn search_contacts(query: String) -> TauResult<Vec<GoogleContact>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = RencalConfig::load();
    if !cfg.google_contacts_enabled {
        return Ok(Vec::new());
    }
    let Some(refresh) = cfg.google_meet_refresh_token else {
        return Ok(Vec::new());
    };
    let Ok(token) = google_meet::access_token(&refresh).await else {
        return Ok(Vec::new());
    };
    match google_meet::search_contacts(&token, query).await {
        Ok(contacts) => Ok(contacts
            .into_iter()
            .map(|c| GoogleContact {
                name: c.name,
                email: c.email,
            })
            .collect()),
        Err(_) => Ok(Vec::new()),
    }
}

pub(super) async fn disconnect() -> TauResult<()> {
    let mut cfg = RencalConfig::load();
    cfg.google_meet_refresh_token = None;
    cfg.save()
}

/// Create an event with a fresh Google Meet link. Returns the Meet URL.
/// The caller should trigger a sync afterwards to pull the event into caldir.
pub(super) async fn create_event_with_meet(input: CreateMeetEventInput) -> TauResult<String> {
    let cfg = RencalConfig::load();
    let refresh = cfg
        .google_meet_refresh_token
        .ok_or_else(|| "Connect your Google account for Meet first".to_string())?;

    // Resolve the Google calendar id (the primary calendar's address for a
    // primary calendar; a group id for secondary calendars).
    let caldir = load_caldir()?;
    let calendar = caldir
        .calendar(&input.calendar_slug)
        .map_err(|e| e.to_string())?;
    let calendar_id = calendar_self_email(&calendar)
        .ok_or_else(|| "This calendar isn't a Google calendar".to_string())?;

    let token = google_meet::access_token(&refresh)
        .await
        .map_err(|e| e.to_string())?;

    let request_id = format!(
        "cosmical-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let time_json = |iso: &str, date: &str| -> Value {
        if input.all_day {
            json!({ "date": date })
        } else {
            json!({ "dateTime": iso })
        }
    };

    let mut event = json!({
        "summary": input.summary,
        "start": time_json(&input.start_iso, &input.start_date),
        "end": time_json(&input.end_iso, &input.end_date),
        "conferenceData": {
            "createRequest": {
                "requestId": request_id,
                "conferenceSolutionKey": { "type": "hangoutsMeet" }
            }
        },
    });
    if let Some(d) = input.description.filter(|s| !s.is_empty()) {
        event["description"] = json!(d);
    }
    if let Some(l) = input.location.filter(|s| !s.is_empty()) {
        event["location"] = json!(l);
    }
    if !input.attendees.is_empty() {
        event["attendees"] = Value::Array(
            input
                .attendees
                .iter()
                .map(|email| json!({ "email": email }))
                .collect(),
        );
    }

    let created = google_meet::insert_event(&token, &calendar_id, &event)
        .await
        .map_err(|e| e.to_string())?;

    // The Meet conference is created asynchronously: `insert` frequently returns
    // before Google has minted the link. Poll the event until the conference
    // finalizes so that the caller's follow-up sync pulls a complete event
    // (which caldir then exposes as X-GOOGLE-CONFERENCE → the Join button),
    // matching how Google-Calendar-created Meet events appear.
    if let Some(link) = google_meet::meet_link(&created) {
        return Ok(link);
    }
    if let Some(event_id) = created["id"].as_str() {
        for _ in 0..8 {
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
            if let Ok(ev) = google_meet::get_event(&token, &calendar_id, event_id).await {
                if let Some(link) = google_meet::meet_link(&ev) {
                    return Ok(link);
                }
            }
        }
    }

    // Conference still pending after the wait — the event exists and will gain
    // its link on a later sync; return empty rather than failing the create.
    Ok(String::new())
}
