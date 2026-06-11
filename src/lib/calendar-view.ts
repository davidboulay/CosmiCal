import z from "zod"

export const calendarViewSchema = z.enum(["week", "3day", "month"])

export type CalendarView = z.infer<typeof calendarViewSchema>

export const CALENDAR_VIEW_KEY = "calendarView"

/** Number of day columns the time-grid views render. */
export const VISIBLE_DAYS: Record<"week" | "3day", number> = {
  week: 7,
  "3day": 3,
}
