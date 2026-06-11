import { Temporal } from "@js-temporal/polyfill"
import { format, getYear, isToday, isTomorrow, isYesterday } from "date-fns"

import type { TimeFormat } from "@/rpc/bindings"

import { allDayFromLocalDate } from "./constructors"
import { getLocalTzid } from "./local-zone"
import {
  dateInViewerZone,
  instantForOrdering,
  isAllDay,
  toInteropDate,
  toViewerZonedDateTime,
} from "./projections"
import type { EventTime } from "./types"

/** "YYYY-MM-DD" in the viewer's local zone. Used as a stable grouping key. */
export function formatDateKey(et: EventTime | Date): string {
  if (et instanceof Date) return dateInViewerZone(allDayFromLocalDate(et)).toString()
  return dateInViewerZone(et).toString()
}

const timeFormatters: Partial<Record<TimeFormat, Intl.DateTimeFormat>> = {}

function getTimeFormatter(timeFormat: TimeFormat): Intl.DateTimeFormat {
  let f = timeFormatters[timeFormat]
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: timeFormat === "12h" ? "h12" : "h23",
      timeZone: getLocalTzid(),
    })
    timeFormatters[timeFormat] = f
  }
  return f
}

export function formatTime(et: EventTime, timeFormat: TimeFormat): string {
  if (isAllDay(et)) return ""
  return getTimeFormatter(timeFormat).format(toViewerZonedDateTime(et).epochMilliseconds)
}

const zonedTimeFormatters: Record<string, Intl.DateTimeFormat> = {}

function getZonedTimeFormatter(timeFormat: TimeFormat, tzid: string): Intl.DateTimeFormat {
  const key = `${timeFormat}|${tzid}`
  let f = zonedTimeFormatters[key]
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: timeFormat === "12h" ? "h12" : "h23",
      timeZone: tzid,
    })
    zonedTimeFormatters[key] = f
  }
  return f
}

/** Like {@link formatTime}, but renders the instant in an explicit IANA zone. */
export function formatTimeInZone(et: EventTime, timeFormat: TimeFormat, tzid: string): string {
  if (isAllDay(et)) return ""
  return getZonedTimeFormatter(timeFormat, tzid).format(instantForOrdering(et).epochMilliseconds)
}

/** City portion of an IANA zone id, e.g. "America/New_York" → "New York". */
export function getZoneCity(tzid: string): string {
  const last = tzid.split("/").pop() ?? tzid
  return last.replace(/_/g, " ")
}

/** Display name for a zone: the user's custom label if set, else the city. */
export function getZoneDisplayName(tzid: string, labels?: Record<string, string>): string {
  const custom = labels?.[tzid]?.trim()
  return custom || getZoneCity(tzid)
}

/** Short label for a zone at a given instant, e.g. "GMT+9" or "EST". */
export function getZoneAbbr(tzid: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
      hour: "numeric",
      timeZoneName: "short",
    }).formatToParts(at)
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tzid
  } catch {
    return tzid
  }
}

/**
 * Format a wallclock hour (0–23) and minute per the 12h/24h setting,
 * e.g. "15:30" (24h) or "3:30 PM" (12h). Zone-agnostic — it formats a
 * time-of-day rather than an instant, so it's safe for time-picker option
 * labels where there is no underlying EventTime.
 */
export function formatWallclockTime(hour: number, minute: number, timeFormat: TimeFormat): string {
  const mm = String(minute).padStart(2, "0")
  if (timeFormat === "24h") return `${String(hour).padStart(2, "0")}:${mm}`
  const period = hour < 12 ? "AM" : "PM"
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${mm} ${period}`
}

/** "Mon, 28 Apr" or "Mon, 28 Apr 2027" if not the current year. */
export function formatShortDate(et: EventTime | Date): string {
  const d = et instanceof Date ? et : toInteropDate(et)
  const pattern = getYear(d) !== getYear(new Date()) ? "EEE, d MMM yyyy" : "EEE, d MMM"
  return format(d, pattern)
}

/** "Today" / "Tomorrow" / "Yesterday" / weekday name. */
export function getRelativeDayLabel(et: EventTime | Date): string {
  const d = et instanceof Date ? et : toInteropDate(et)
  if (isToday(d)) return "Today"
  if (isTomorrow(d)) return "Tomorrow"
  if (isYesterday(d)) return "Yesterday"
  return format(d, "EEEE")
}

export function plainDateToLocalDate(pd: Temporal.PlainDate): Date {
  return new Date(pd.year, pd.month - 1, pd.day)
}

export function localDateToPlainDate(d: Date): Temporal.PlainDate {
  return new Temporal.PlainDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
