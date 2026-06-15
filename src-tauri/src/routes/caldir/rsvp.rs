use super::helpers::{calendar_self_email, load_caldir};
use crate::event_cache::EVENT_CACHE;
use crate::google_meet;
use crate::routes::TauResult;
use caldir_core::{EventInstanceId, ParticipationStatus};
use rencal_config::RencalConfig;

pub(super) async fn handler(
    calendar_slug: String,
    event_id: String,
    response: String,
) -> TauResult<()> {
    let caldir = load_caldir()?;
    let calendar = caldir.calendar(&calendar_slug).map_err(|e| e.to_string())?;

    let user_email = calendar_self_email(&calendar)
        .ok_or_else(|| "Calendar has no account email".to_string())?;

    let instance_id = EventInstanceId::from(event_id.as_str());
    let status = parse_participation_status(&response)?;

    let is_google = calendar
        .remote_config()
        .map(|rc| rc.provider_slug().as_str() == "google")
        .unwrap_or(false);

    // Google: RSVP straight through the Calendar API, changing only our own
    // responseStatus. caldir's local update bumps SEQUENCE and pushes the whole
    // event, which Google rejects for events you don't organize ("Shared
    // properties can only be changed by the organizer") and then retries
    // forever. The direct patch avoids creating any outgoing change at all.
    if is_google {
        if let Some(refresh) = RencalConfig::load().google_meet_refresh_token {
            let ical_uid = instance_id.uid().as_str();
            let instance_utc = instance_id
                .recurrence_id()
                .map(|r| r.as_event_time().to_utc());

            let token = google_meet::access_token(&refresh)
                .await
                .map_err(|e| e.to_string())?;
            // For a primary Google calendar the calendar id equals the user's
            // address (what `calendar_self_email` returns), which is also the
            // attendee we're updating.
            let google_event_id =
                google_meet::resolve_event_id(&token, &user_email, ical_uid, instance_utc)
                    .await
                    .map_err(|e| e.to_string())?;
            google_meet::set_response_status(
                &token,
                &user_email,
                &google_event_id,
                &user_email,
                google_response_status(status),
            )
            .await
            .map_err(|e| e.to_string())?;

            EVENT_CACHE.invalidate(&calendar_slug);
            return Ok(());
        }
        // Not connected to Google OAuth — fall through to the caldir path.
    }

    // Non-Google (e.g. iCloud) or not connected: update locally and let sync push.
    if instance_id.recurrence_id().is_some() {
        let mut result = Ok(());

        calendar
            .update_recurring_instance(&instance_id, |event| {
                result = event.set_attendee_status(&user_email, status);
            })
            .map_err(|e| e.to_string())?;

        result.map_err(|e| e.to_string())?;
    } else {
        let mut cal_event = calendar
            .event_by_instance_id(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Event not found: {}", event_id))?;

        cal_event
            .update_attendee_status(&user_email, status)
            .map_err(|e| e.to_string())?;
    }

    EVENT_CACHE.invalidate(&calendar_slug);

    Ok(())
}

fn google_response_status(s: ParticipationStatus) -> &'static str {
    match s {
        ParticipationStatus::Accepted => "accepted",
        ParticipationStatus::Declined => "declined",
        ParticipationStatus::Tentative => "tentative",
        ParticipationStatus::NeedsAction => "needsAction",
    }
}

fn parse_participation_status(s: &str) -> Result<ParticipationStatus, String> {
    match s {
        "accepted" => Ok(ParticipationStatus::Accepted),
        "declined" => Ok(ParticipationStatus::Declined),
        "tentative" => Ok(ParticipationStatus::Tentative),
        "needs-action" => Ok(ParticipationStatus::NeedsAction),
        other => Err(format!("Unknown participation status: {}", other)),
    }
}
