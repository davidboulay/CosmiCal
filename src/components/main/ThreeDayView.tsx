import { WeekView } from "@/components/main/week-view/WeekView"

import { VISIBLE_DAYS } from "@/lib/calendar-view"

// 3-Day view: the week time-grid parameterized to show three day columns.
export function ThreeDayView() {
  return <WeekView visibleDays={VISIBLE_DAYS["3day"]} />
}
