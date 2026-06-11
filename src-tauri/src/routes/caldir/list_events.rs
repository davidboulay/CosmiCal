use super::helpers::load_caldir;
use super::helpers::{event_time_sort_key, is_visible};
use super::types::{CalendarEvent, RpcRecurrence, core_recurrence_to_rpc};
use crate::event_cache::EVENT_CACHE;
use crate::routes::TauResult;
use caldir_core::expand_in_range;
use chrono::{DateTime, Utc};
use std::collections::HashMap;

pub(super) async fn handler(
    calendar_slugs: Vec<String>,
    start: String,
    end: String,
) -> TauResult<Vec<CalendarEvent>> {
    let range_start: DateTime<Utc> = start
        .parse()
        .map_err(|e: chrono::ParseError| e.to_string())?;
    let range_end: DateTime<Utc> = end.parse().map_err(|e: chrono::ParseError| e.to_string())?;

    let caldir = load_caldir()?;
    let mut events = Vec::new();

    for slug in &calendar_slugs {
        let parsed = EVENT_CACHE.events(&caldir, slug)?;
        let master_recurrences: HashMap<String, RpcRecurrence> = parsed
            .iter()
            .filter_map(|e| {
                e.recurrence
                    .as_ref()
                    .map(|r| (e.uid.as_str().to_string(), core_recurrence_to_rpc(r)))
            })
            .collect();

        // Authoritative override per occurrence, taken from the RAW parsed
        // events and keyed by UTC instant. `expand_in_range` matches overrides
        // by their timezone *representation*, so when a series is recreated or
        // timezone-migrated on the server the leftover copy stops matching the
        // new master and is silently dropped — leaving the stale copy to win
        // and show wrong attendee/RSVP statuses. Per RFC 5545 the authoritative
        // version is the highest SEQUENCE (tie-break: most recently modified);
        // we recover it here by instant.
        let occurrence_key = |e: &caldir_core::Event| -> Option<(String, i64)> {
            e.recurrence_id
                .as_ref()
                .map(|r| (e.uid.as_str().to_string(), r.as_event_time().to_utc().timestamp_millis()))
        };
        let mut authoritative: HashMap<(String, i64), caldir_core::Event> = HashMap::new();
        for ev in parsed.iter() {
            let Some(key) = occurrence_key(ev) else { continue };
            let better = match authoritative.get(&key) {
                Some(cur) => (ev.sequence, ev.last_modified) > (cur.sequence, cur.last_modified),
                None => true,
            };
            if better {
                authoritative.insert(key, ev.clone());
            }
        }

        let mut by_occurrence: HashMap<(String, i64), caldir_core::Event> = HashMap::new();
        let mut singles: Vec<caldir_core::Event> = Vec::new();
        for event in expand_in_range(parsed.iter().cloned(), range_start, range_end) {
            match occurrence_key(&event) {
                Some(key) => {
                    // Prefer the authoritative override when it outranks what
                    // expansion produced for this occurrence.
                    let chosen = match authoritative.get(&key) {
                        Some(auth)
                            if (auth.sequence, auth.last_modified)
                                > (event.sequence, event.last_modified) =>
                        {
                            auth.clone()
                        }
                        _ => event,
                    };
                    if !is_visible(&chosen) {
                        continue;
                    }
                    let wins = match by_occurrence.get(&key) {
                        Some(cur) => {
                            (chosen.sequence, chosen.last_modified)
                                > (cur.sequence, cur.last_modified)
                        }
                        None => true,
                    };
                    if wins {
                        by_occurrence.insert(key, chosen);
                    }
                }
                None => {
                    if is_visible(&event) {
                        singles.push(event)
                    }
                }
            }
        }

        for event in singles.into_iter().chain(by_occurrence.into_values()) {
            let master_rec = master_recurrences.get(event.uid.as_str()).cloned();
            events.push(CalendarEvent::from_event(&event, slug, master_rec));
        }
    }

    events.sort_by_key(|a| event_time_sort_key(&a.start));
    Ok(events)
}
