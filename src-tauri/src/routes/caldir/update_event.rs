use super::helpers::load_caldir;
use super::types::{
    UpdateEventInput, rpc_recurrence_to_core, rpc_time_to_core, set_conference_url,
};
use crate::event_cache::EVENT_CACHE;
use crate::routes::TauResult;
use caldir_core::{Attendee, EventInstanceId, Reminder};
use chrono::Utc;

/// Loose check that an address is a real email (not a Google obfuscated id like
/// "/aMjA…"). Good enough to keep providers from rejecting a create.
fn is_valid_email(email: &str) -> bool {
    let e = email.trim().strip_prefix("mailto:").unwrap_or(email.trim());
    match e.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && !e.contains(char::is_whitespace)
                && !e.starts_with('/')
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        None => false,
    }
}

pub(super) async fn handler(input: UpdateEventInput) -> TauResult<()> {
    let caldir = load_caldir()?;

    let calendar = caldir
        .calendar(&input.calendar_slug)
        .map_err(|e| e.to_string())?;

    let id = EventInstanceId::from(input.id.as_str());

    let start = rpc_time_to_core(&input.start)?;
    let end = rpc_time_to_core(&input.end)?;

    let input_reminders: Vec<Reminder> = input
        .reminders
        .iter()
        .map(|&m| Reminder {
            minutes_before_start: m as i64,
        })
        .collect();
    let input_attendees: Vec<Attendee> = input.attendees.iter().map(|a| a.to_core()).collect();

    let moving = input
        .new_calendar_slug
        .as_ref()
        .is_some_and(|new_slug| new_slug != &input.calendar_slug);

    // "Edit only this event" of a recurring series:
    if id.recurrence_id().is_some() {
        if moving {
            return Err("Cannot move a recurring instance to another calendar; \
                 move the whole series instead"
                .to_string());
        }

        calendar
            .update_recurring_instance(&id, |event| {
                event.summary = Some(input.summary);
                event.description = input.description;
                event.location = input.location;
                event.start = start;
                event.end = Some(end);
                event.reminders = input_reminders;
                event.attendees = input_attendees;
                set_conference_url(event, input.conference_url.as_deref());
            })
            .map_err(|e| e.to_string())?;

        EVENT_CACHE.invalidate(&input.calendar_slug);

        Ok(())
    } else {
        let mut existing_calendar_event = calendar
            .event_by_instance_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Event not found: {}", input.id))?;

        let mut updated_event = existing_calendar_event.event().clone();

        let input_recurrence = input
            .recurrence
            .as_ref()
            .map(rpc_recurrence_to_core)
            .transpose()?;

        updated_event.summary = Some(input.summary);
        updated_event.description = input.description;
        updated_event.location = input.location;
        updated_event.start = start;
        updated_event.end = Some(end);
        updated_event.recurrence = input_recurrence;
        updated_event.reminders = input_reminders;
        updated_event.attendees = input_attendees;
        updated_event.last_modified = Some(Utc::now());
        updated_event.sequence += 1;
        set_conference_url(&mut updated_event, input.conference_url.as_deref());

        // Drop attendees whose address isn't a real email — Google events often
        // carry the self/organizer as an opaque obfuscated id (e.g.
        // "mailto:/aMjA…") which a provider rejects with "Invalid attendee
        // email" when the event is pushed (notably on a cross-calendar create).
        // Likewise clear an invalid organizer so the provider assigns the owner.
        let before = updated_event.attendees.len();
        updated_event.attendees.retain(|a| is_valid_email(&a.email));
        let dropped = before - updated_event.attendees.len();
        if dropped > 0 {
            log::info!("update {}: dropped {dropped} attendee(s) with an invalid email", input.id);
        }
        if updated_event
            .organizer
            .as_ref()
            .is_some_and(|o| !is_valid_email(&o.email))
        {
            updated_event.organizer = None;
        }

        if moving {
            let new_slug = input.new_calendar_slug.as_ref().unwrap();
            log::info!(
                "move event {} from [{}] to [{}]",
                input.id,
                input.calendar_slug,
                new_slug
            );
            let target_calendar = caldir.calendar(new_slug).map_err(|e| {
                log::warn!("move: target calendar [{new_slug}] not found: {e}");
                e.to_string()
            })?;

            // New UID so remote providers treat it as a fresh event
            let moved_event = updated_event.with_new_uid();

            // Create in target calendar first (safe: if this fails, original is untouched)
            target_calendar.create_event(moved_event).map_err(|e| {
                log::warn!("move: create in [{new_slug}] failed: {e}");
                e.to_string()
            })?;

            // Only delete from source after successful creation
            existing_calendar_event.delete().map_err(|e| {
                log::warn!("move: delete from [{}] failed: {e}", input.calendar_slug);
                e.to_string()
            })?;

            log::info!("move event {} succeeded", input.id);
            EVENT_CACHE.invalidate(&input.calendar_slug);
            EVENT_CACHE.invalidate(new_slug);
        } else {
            existing_calendar_event
                .update(updated_event)
                .map_err(|e| e.to_string())?;

            EVENT_CACHE.invalidate(&input.calendar_slug);
        }

        Ok(())
    }
}
