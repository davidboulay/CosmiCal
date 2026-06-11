import { addDays, addMonths, isSameDay } from "date-fns"

import { SettingsButton } from "@/components/toolbar/SettingsButton"
import { SearchBar } from "@/components/toolbar/search/SearchBar"
import { Button } from "@/components/ui/button"
import { DragRegion } from "@/components/ui/drag-region"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"

import { useCalendarNavigation } from "@/contexts/CalendarStateContext"

import { CalendarView } from "@/lib/calendar-view"

import { ChevronLeftIcon } from "@/icons/chevron-left"
import { ChevronRightIcon } from "@/icons/chevron-right"

// Shift `date` by one window of the active view (used by the prev/next arrows).
function shiftByView(date: Date, view: CalendarView, dir: 1 | -1): Date {
  switch (view) {
    case "month":
      return addMonths(date, dir)
    case "3day":
      return addDays(date, dir * 3)
    case "week":
    default:
      return addDays(date, dir * 7)
  }
}

export function MainHeader({ calendarView }: { calendarView: CalendarView }) {
  const { activeDate, navigateToDate, scrollToNow, nowLineVisible } = useCalendarNavigation()

  const onToday = isSameDay(activeDate, new Date())

  // The button is "focused" (resting, default color, "Today") only when nothing
  // needs re-centering. In week/3-Day that also requires the now-line to be in
  // view — if you're on today but scrolled away from it, the button becomes
  // "Focus on Now". Month has no now-line, so on-today is enough.
  const isMonth = calendarView === "month"
  const focused = isMonth ? onToday : onToday && nowLineVisible
  const todayLabel = isMonth
    ? onToday
      ? "Today"
      : "Focus on Today"
    : focused
      ? "Today"
      : onToday
        ? "Focus on Now"
        : "Focus on Today"

  return (
    <div className="shrink-0 flex gap-2 p-4">
      <div className="flex gap-2 items-center">
        <ShortcutTooltip text="Go to Today" shortcut="t">
          <Button
            tabIndex={-1}
            variant="secondary"
            onClick={() => {
              void navigateToDate(new Date())
              // Center the now-line once; repeat after the grid settles so it
              // also lands centered in 3-Day view, where jumping to today can
              // reset the visible day range and discard the first scroll.
              scrollToNow()
              setTimeout(() => scrollToNow(), 150)
            }}
            // Red (#D33A30, the now-line color) whenever it'll re-center;
            // default button color when already focused on now/today.
            style={!focused ? { backgroundColor: "#D33A30", color: "#fff" } : undefined}
          >
            {todayLabel}
          </Button>
        </ShortcutTooltip>

        <Button
          tabIndex={-1}
          variant="secondary"
          size="icon"
          aria-label="Previous"
          onClick={() => void navigateToDate(shiftByView(activeDate, calendarView, -1))}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          tabIndex={-1}
          variant="secondary"
          size="icon"
          aria-label="Next"
          onClick={() => void navigateToDate(shiftByView(activeDate, calendarView, 1))}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      <DragRegion className="grow h-full" />

      <TabsList onMouseDown={(e) => e.preventDefault()} tabIndex={-1}>
        <CalendarViewTab view="3day" name="3-Day" shortcut="3" />
        <CalendarViewTab view="week" name="Week" shortcut="w" />
        <CalendarViewTab view="month" name="Month" shortcut="m" />
      </TabsList>

      <SettingsButton />
      <SearchBar className="w-56 starting:w-56" eventPopoverSide="left" />
    </div>
  )
}

const CalendarViewTab = ({
  view,
  name,
  shortcut,
}: {
  view: CalendarView
  name: string
  shortcut: string
}) => {
  return (
    <ShortcutTooltip text={`${name} view`} shortcut={shortcut}>
      <span className="h-full">
        <TabsTrigger
          value={view}
          tabIndex={-1}
          className="data-[state=active]:bg-today! data-[state=active]:text-primary-foreground!"
        >
          {name}
        </TabsTrigger>
      </span>
    </ShortcutTooltip>
  )
}
