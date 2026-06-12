import { Temporal } from "@js-temporal/polyfill"

import { allDayDate } from "./constructors"
import { formatDateKey } from "./display"
import { addDays, addMinutes, withViewerDate, withViewerWallclockTime } from "./edit"
import { startOfDayMs } from "./layout"
import { dateInViewerZone, instantForOrdering, isAllDay } from "./projections"
import type { EventTime, EventTimeRange } from "./types"

/**
 * Ensure an all-day event's [start, end) range is valid: end's day must be at
 * least one day after start's day.
 */
export function normalizeAllDayRange(start: EventTime, end: EventTime): EventTimeRange {
  const needsBump = startOfDayMs(end) <= startOfDayMs(start)
  return { start, end: needsBump ? addDays(start, 1) : end }
}

/**
 * The viewer-local date keys (YYYY-MM-DD) this event occupies. For timed
 * events that is a single key. For all-day events that is start inclusive
 * through end exclusive, following iCalendar's DTEND convention.
 */
export function* enumerateLocalDateKeys(start: EventTime, end: EventTime): Generator<string> {
  if (!isAllDay(start)) {
    yield formatDateKey(start)
    return
  }

  const startKey = formatDateKey(start)
  const endKey = formatDateKey(end)
  if (startKey >= endKey) {
    yield startKey
    return
  }

  let current: EventTime = start
  while (formatDateKey(current) < endKey) {
    yield formatDateKey(current)
    current = addDays(current, 1)
  }
}

export function withRangeStartWallclockTime(
  range: EventTimeRange,
  hour: number,
  minute: number,
): EventTimeRange {
  const start = withViewerWallclockTime(range.start, hour, minute)
  const deltaMin = Math.round(
    (instantForOrdering(start).epochMilliseconds -
      instantForOrdering(range.start).epochMilliseconds) /
      60_000,
  )
  const end = isAllDay(range.end) ? range.end : addMinutes(range.end, deltaMin)
  return { start, end }
}

export function withRangeEndWallclockTime(
  range: EventTimeRange,
  hour: number,
  minute: number,
): EventTimeRange {
  let end = withViewerWallclockTime(range.end, hour, minute)
  if (
    !isAllDay(range.start) &&
    instantForOrdering(end).epochMilliseconds < instantForOrdering(range.start).epochMilliseconds
  ) {
    end = addDays(end, 1)
  }
  return { start: range.start, end }
}

export function withRangeStartDate(
  range: EventTimeRange,
  newDate: Temporal.PlainDate,
): EventTimeRange {
  const oldDate = dateInViewerZone(range.start)
  const dayDelta = newDate.since(oldDate, { largestUnit: "days" }).days
  return {
    start: withViewerDate(range.start, newDate),
    end: addDays(range.end, dayDelta),
  }
}

export function withRangeDisplayEndDate(
  range: EventTimeRange,
  pickedDate: Temporal.PlainDate,
): EventTimeRange {
  if (isAllDay(range.start)) {
    const startDate = dateInViewerZone(range.start)
    const clamped = Temporal.PlainDate.compare(pickedDate, startDate) < 0 ? startDate : pickedDate
    return { start: range.start, end: allDayDate(clamped.add({ days: 1 })) }
  }

  return { start: range.start, end: withViewerDate(range.end, pickedDate) }
}

export function displayEndDate(range: EventTimeRange): Temporal.PlainDate {
  return dateInViewerZone(isAllDay(range.start) ? addDays(range.end, -1) : range.end)
}

export function shouldShowDisplayEndDate(range: EventTimeRange): boolean {
  if (isAllDay(range.start)) return true
  return !dateInViewerZone(range.start).equals(dateInViewerZone(range.end))
}
