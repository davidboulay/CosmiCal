import { rpc } from "@/rpc"
import type { Calendar } from "@/rpc/bindings"

import type { CalendarEvent } from "@/lib/cal-events"
import { getCalendarEventsForRange, getStartRangeForDate } from "@/lib/cal-events-range"
import { logger } from "@/lib/logger"
import type { DateRange } from "@/lib/types"

export type Preload = {
  initialCalendars?: Calendar[]
  initialEvents?: CalendarEvent[]
  initialDate?: Date
  initialRange?: DateRange
}

/** Calendars the user has hidden, read straight from localStorage so the very
 * first paint respects their visibility choices (the React context reads the
 * same "hiddenCalendars" key). */
function hiddenCalendarSlugs(): Set<string> {
  try {
    const raw = localStorage.getItem("hiddenCalendars")
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [],
    )
  } catch {
    return new Set()
  }
}

export async function preloadCalendarData(): Promise<Preload> {
  try {
    const initialDate = new Date()
    const initialCalendars = await rpc.caldir.list_calendars()
    // Keep the full calendar list (the left panel needs it), but only preload
    // events for the *visible* calendars — otherwise the first frame shows
    // hidden calendars until a later reload drops them.
    const hidden = hiddenCalendarSlugs()
    const slugs = initialCalendars.filter((c) => !hidden.has(c.slug)).map((c) => c.slug)

    if (slugs.length === 0) {
      return { initialCalendars, initialEvents: [], initialDate }
    }

    const initialRange = getStartRangeForDate(initialDate)
    const initialEvents = await getCalendarEventsForRange(
      slugs,
      initialRange.start,
      initialRange.end,
    )
    return { initialCalendars, initialEvents, initialDate, initialRange }
  } catch (err) {
    logger.error("Preload failed, falling back to lazy load", err)
    return {}
  }
}
