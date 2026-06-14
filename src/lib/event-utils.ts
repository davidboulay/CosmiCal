import type { Calendar, ResponseStatus } from "@/rpc/bindings"

import type { CalendarEvent } from "@/lib/cal-events"

/** The user's own address(es) on a calendar, lowercased. Prefers the real
 *  remote email; falls back to the account identifier when no email is set. */
function calendarSelfEmails(calendar: Calendar | undefined): string[] {
  if (!calendar) return []
  return [calendar.email, calendar.account]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase())
}

export function getUserResponseStatus(
  event: CalendarEvent,
  calendars: Calendar[],
): ResponseStatus | null {
  const calendar = calendars.find((c) => c.slug === event.calendar_slug)
  const selfEmails = calendarSelfEmails(calendar)
  if (selfEmails.length === 0) return null

  const attendee = event.attendees.find((a) => selfEmails.includes(a.email.toLowerCase()))
  if (!attendee) return null

  // Per RFC 5545 the default participation status for an attendee with no
  // explicit PARTSTAT is NEEDS-ACTION. Many providers send real, unanswered
  // invites without a PARTSTAT, so treat a missing status as needs-action —
  // unless the user is the organizer, who is implicitly attending.
  if (attendee.response_status) return attendee.response_status

  const isOrganizer = !!event.organizer && selfEmails.includes(event.organizer.email.toLowerCase())
  return isOrganizer ? null : "needs-action"
}

export function isUserOrganizer(event: CalendarEvent, calendars: Calendar[]): boolean {
  if (!event.organizer) return true
  if (event.attendees.length === 0) return true
  const calendar = calendars.find((c) => c.slug === event.calendar_slug)
  const selfEmails = calendarSelfEmails(calendar)
  if (selfEmails.length === 0) return true
  return selfEmails.includes(event.organizer.email.toLowerCase())
}

export function isEventReadonly(event: CalendarEvent, calendars: Calendar[]): boolean {
  const calendar = calendars.find((c) => c.slug === event.calendar_slug)
  if (calendar?.read_only) return true
  return !isUserOrganizer(event, calendars)
}

/** Whether the event lives on a writable calendar — i.e. it can be deleted or
 * moved off that calendar, even if its content is otherwise read-only (an
 * invitation you don't organize). */
export function isCalendarWritable(event: CalendarEvent, calendars: Calendar[]): boolean {
  const calendar = calendars.find((c) => c.slug === event.calendar_slug)
  return !!calendar && !calendar.read_only
}

export function isPendingEvent(event: CalendarEvent, calendars: Calendar[]): boolean {
  return getUserResponseStatus(event, calendars) === "needs-action"
}

export function isDeclinedEvent(event: CalendarEvent, calendars: Calendar[]): boolean {
  return getUserResponseStatus(event, calendars) === "declined"
}
