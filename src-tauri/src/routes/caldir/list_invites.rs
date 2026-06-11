use super::helpers::load_caldir;
use super::helpers::{calendar_self_email, event_time_sort_key, is_pending_invite_for, is_visible};
use super::types::CalendarEvent;
use crate::event_cache::EVENT_CACHE;
use crate::routes::TauResult;
use chrono::Utc;

pub(super) async fn handler(calendar_slugs: Vec<String>) -> TauResult<Vec<CalendarEvent>> {
    let caldir = load_caldir()?;
    let now = Utc::now();
    let mut invites = Vec::new();

    for slug in &calendar_slugs {
        let calendar = caldir.calendar(slug).map_err(|e| e.to_string())?;

        let email = match calendar_self_email(&calendar) {
            Some(e) => e,
            None => continue,
        };

        let parsed = EVENT_CACHE.events(&caldir, slug)?;
        for event in parsed.iter() {
            if !is_visible(event) {
                continue;
            }
            let is_future = event
                .end
                .as_ref()
                .map(|e| e.to_utc())
                .unwrap_or_else(|| event.start.to_utc())
                >= now;
            if is_pending_invite_for(event, &email) && is_future {
                invites.push(CalendarEvent::from_event(event, slug, None));
            }
        }
    }

    invites.sort_by_key(|a| event_time_sort_key(&a.start));
    Ok(invites)
}
