import { useEffect, useMemo, useState } from "react"

import { rpc } from "@/rpc"
import { EventAttendee } from "@/rpc/bindings"

import { useCalEvents } from "@/contexts/CalEventsContext"

export interface ContactSuggestion {
  email: string
  /** Best-known display name for this contact, if any. */
  name: string | null
}

interface ContactAccumulator {
  email: string
  name: string | null
  /** Number of events this contact appeared in — used for frequency ranking. */
  count: number
  /** Highest event start timestamp (ms) seen for this contact — recency tiebreaker. */
  lastSeen: number
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/**
 * Builds a contact "address book" from the calendar events already loaded into
 * the CalEvents context. There is no dedicated contacts API, so we mine unique
 * attendees + organizers from every loaded event.
 *
 * Contacts are ranked by frequency (how many events they appear in), with the
 * most-recently-seen event start time as a tiebreaker. The first non-empty name
 * encountered (preferring higher-frequency / more-recent appearances via the
 * accumulation order) wins as the display name.
 */
export function useContactSuggestions() {
  const { calendarEvents } = useCalEvents()

  const contacts = useMemo<ContactSuggestion[]>(() => {
    const byEmail = new Map<string, ContactAccumulator>()

    const ingest = (person: EventAttendee | null | undefined, startMs: number) => {
      if (!person?.email) return
      const key = normalizeEmail(person.email)
      if (!key) return

      const name = person.name?.trim() || null
      const existing = byEmail.get(key)

      if (existing) {
        existing.count += 1
        if (name && !existing.name) existing.name = name
        if (startMs > existing.lastSeen) existing.lastSeen = startMs
      } else {
        byEmail.set(key, {
          // Preserve the original casing of the address for display.
          email: person.email.trim(),
          name,
          count: 1,
          lastSeen: startMs,
        })
      }
    }

    for (const event of calendarEvents) {
      const startMs = event.dateInfo.startMs
      ingest(event.organizer, startMs)
      for (const attendee of event.attendees) ingest(attendee, startMs)
    }

    return Array.from(byEmail.values())
      .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
      .map(({ email, name }) => ({ email, name }))
  }, [calendarEvents])

  return contacts
}

/**
 * Searches the connected Google account's real contacts (saved + auto-saved)
 * for `query`, debounced. Returns [] when not connected, the contacts scope
 * isn't granted, or the query is too short — callers merge these with the
 * event-mined suggestions from {@link useContactSuggestions}.
 */
export function useGoogleContactSearch(query: string): ContactSuggestion[] {
  const [results, setResults] = useState<ContactSuggestion[]>([])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      rpc.caldir
        .search_google_contacts(q)
        .then((contacts) => {
          if (!cancelled) setResults(contacts.map((c) => ({ email: c.email, name: c.name })))
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return results
}

/**
 * Filters the contact book to those matching `query` on email OR name
 * (case-insensitive substring), excluding any addresses already in use.
 * Returns at most `limit` results, preserving the frequency/recency ranking.
 */
export function filterContactSuggestions(
  contacts: ContactSuggestion[],
  query: string,
  excludeEmails: Iterable<string>,
  limit = 6,
): ContactSuggestion[] {
  const q = query.trim().toLowerCase()
  const excluded = new Set<string>()
  for (const e of excludeEmails) excluded.add(normalizeEmail(e))

  const results: ContactSuggestion[] = []
  for (const contact of contacts) {
    if (excluded.has(normalizeEmail(contact.email))) continue
    if (q) {
      const haystack = `${contact.email} ${contact.name ?? ""}`.toLowerCase()
      if (!haystack.includes(q)) continue
    }
    results.push(contact)
    if (results.length >= limit) break
  }

  return results
}
