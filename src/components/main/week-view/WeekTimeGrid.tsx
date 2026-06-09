import { format, startOfDay, startOfWeek } from "date-fns"
import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { WeekAllDayBar } from "@/components/events-blocks/week-view/AllDayEventBlock"
import { WeekTimedEvent } from "@/components/events-blocks/week-view/TimedEventBlock"

import type { TimeFormat } from "@/rpc/bindings"

import { useCalEvents } from "@/contexts/CalEventsContext"
import { useCalendarNavigation, useCalendars } from "@/contexts/CalendarStateContext"
import { useCreateEventGate } from "@/contexts/CreateEventGateContext"
import { useEventDraft } from "@/contexts/EventDraftContext"
import { useSettings } from "@/contexts/SettingsContext"

import type { WeekTimedEventLayout } from "@/hooks/cal-events/useDayRangeLayout"
import type { AllDayLaneItem } from "@/hooks/cal-events/useMonthEventLayout"
import type { MonthDay } from "@/hooks/cal-events/useMonthGrid"
import { useWeather } from "@/hooks/useWeather"
import { eventKey, type CalendarEvent } from "@/lib/cal-events"
import { setDraftAnchor } from "@/lib/draft-anchor"
import {
  addDays,
  allDayFromLocalDate,
  formatDateKey,
  formatWallclockTime,
  fromDate,
  getLocalTzid,
  getZoneDisplayName,
  type EventTime,
} from "@/lib/event-time"
import { isDeclinedEvent, isPendingEvent } from "@/lib/event-utils"
import { cn } from "@/lib/utils"
import { weatherCodeToEmoji, weatherCodeToLabel } from "@/lib/weather"

import { ChevronDownIcon } from "@/icons/chevron-down"

import { AllDayContextMenu } from "./AllDayContextMenu"
import { CurrentTimeIndicator } from "./CurrentTimeIndicator"
import { ScheduledDayContextMenu } from "./ScheduledDayContextMenu"

const HOUR_HEIGHT = 72
const GRID_HEIGHT = 24 * HOUR_HEIGHT
export const GUTTER_WIDTH = 48
const DAY_WIDTH_MIN = 100

// When the all-day region stacks more than this many lanes, collapse it and
// hide the overflow behind an expand toggle (matches Google Calendar).
const MAX_COLLAPSED_ALL_DAY_LANES = 6

const DAY_MINUTES = 24 * 60
// Default duration for an event created by clicking an empty time slot.
const DEFAULT_SLOT_MINUTES = 30

// How long to wait after a scroll event before considering the scroll "settled"
// and updating the activeDate based on the scroll position.
const SCROLL_SETTLE_MS = 300

type WeekTimeGridProps = {
  days: MonthDay[]
  timedByDay: Map<string, WeekTimedEventLayout[]>
  allDayItems: AllDayLaneItem[]
  activeEventKey: string | null
  selectedEventKey: string | null
  activeDateKey: string
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onDayClick: (date: Date) => void
  onScrollActiveChange: (date: Date) => void
  onEventClick: (eventKey: string) => void
  draftEvent: CalendarEvent | null
  dimmed: boolean
}

export function WeekTimeGrid({
  days,
  timedByDay,
  allDayItems,
  activeEventKey,
  selectedEventKey,
  activeDateKey,
  scrollContainerRef,
  onDayClick,
  onScrollActiveChange,
  onEventClick,
  draftEvent,
  dimmed,
}: WeekTimeGridProps) {
  const { calendars } = useCalendars()
  const { registerScrollToNow } = useCalendarNavigation()
  const { activeEvent, setActiveEventKey } = useCalEvents()
  const { draftPopoverOpen, setDraftEvent, setDraftPopoverOpen, setIsDrafting, defaultCalendarId } =
    useEventDraft()
  const { canCreate, promptToConnect } = useCreateEventGate()
  const { timeFormat, extraTimezones, timezoneLabels } = useSettings()

  // Gutter holds one hour-label column per zone: the extra zones first, then the
  // local zone closest to the grid (matches Google Calendar). Width scales with
  // the number of columns.
  const gutterZones = [...extraTimezones, getLocalTzid()]
  const gutterWidth = GUTTER_WIDTH * gutterZones.length

  const N = days.length
  const hasAllDay = allDayItems.length > 0
  const contextTargetRef = useRef<HTMLElement | null>(null)

  // Day-column index range currently scrolled into view (updated on scroll/
  // resize below). The all-day region only ever grows to fit these days, never
  // the taller stacks that may exist on off-screen days in the loaded range.
  const [visibleCols, setVisibleCols] = useState({ start: 0, end: N })

  // Collapse the all-day region when it stacks too many lanes. Collapsed, we
  // render the first few event lanes plus a final row of per-day "N more"
  // tiles, and hide the overflow (matches Google Calendar). Both the collapse
  // decision and the expanded height key off the tallest stack among *visible*
  // days, so a dense off-screen day can't balloon the region.
  const [allDayExpanded, setAllDayExpanded] = useState(false)
  // An item covers day indices [startCol-1, endCol-1); see useDayRangeLayout.
  let maxVisibleAllDayLane = -1
  for (const item of allDayItems) {
    if (item.startCol - 1 < visibleCols.end && item.endCol - 1 > visibleCols.start) {
      if (item.lane > maxVisibleAllDayLane) maxVisibleAllDayLane = item.lane
    }
  }
  const visibleAllDayLaneCount = maxVisibleAllDayLane + 1
  const canCollapseAllDay = visibleAllDayLaneCount > MAX_COLLAPSED_ALL_DAY_LANES
  const allDayCollapsed = canCollapseAllDay && !allDayExpanded
  // Collapsed grid = (event lanes) + (1 "more" row). Expanded = all visible lanes.
  const visibleAllDayLanes = allDayCollapsed ? MAX_COLLAPSED_ALL_DAY_LANES : visibleAllDayLaneCount
  const hasVisibleAllDay = hasAllDay && visibleAllDayLanes > 0
  const eventLaneCutoff = allDayCollapsed ? MAX_COLLAPSED_ALL_DAY_LANES - 1 : visibleAllDayLaneCount
  // Filtering by lane also prevents off-screen items in taller lanes from
  // creating implicit grid rows that would stretch the region's height.
  const visibleAllDayItems = allDayItems.filter((item) => item.lane < eventLaneCutoff)

  // Per-day count of all-day items hidden under the collapsed region.
  const hiddenByDay = (() => {
    if (!allDayCollapsed) return null
    const counts = Array(N).fill(0) as number[]
    for (const item of allDayItems) {
      if (item.lane < eventLaneCutoff) continue
      for (let d = item.startCol - 1; d < item.endCol - 1; d++) {
        if (d >= 0 && d < N) counts[d]++
      }
    }
    return counts
  })()

  // Used to suppress the "update activeDate on scroll" logic during our own programmatic scrolls.
  const ignoreScrollUntilRef = useRef(0)
  const suppressScrollTracking = (durationMs = 500) => {
    ignoreScrollUntilRef.current = Date.now() + durationMs
  }

  // Day width is computed so 7 days fit in the viewport (min-floored).
  // The `ready` flag gates the initial-scroll effect until the width is measured against the real container.
  const [dayWidth, setDayWidth] = useState(180)
  const [dayWidthReady, setDayWidthReady] = useState(false)
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const update = () => {
      const w = Math.max(DAY_WIDTH_MIN, (el.clientWidth - gutterWidth) / 7)
      setDayWidth(w)
      setDayWidthReady(true)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollContainerRef, gutterWidth])

  // Adjust scrollLeft when days are prepended, so the viewport stays over the same content.
  // Detect prepend: the previous firstKey must still be present at position `added` in the new array.
  const prevFirstKeyRef = useRef<string | undefined>(days[0]?.dateKey)
  const prevCountRef = useRef(days.length)
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    const curFirstKey = days[0]?.dateKey
    const prevFirstKey = prevFirstKeyRef.current
    const prevCount = prevCountRef.current
    prevFirstKeyRef.current = curFirstKey
    prevCountRef.current = days.length
    if (!el || !curFirstKey || !prevFirstKey) return
    if (curFirstKey === prevFirstKey) return
    const added = days.length - prevCount
    if (added > 0 && days[added]?.dateKey === prevFirstKey) {
      suppressScrollTracking()
      el.scrollLeft += added * dayWidth
    }
  })

  // Initial scroll (once dayWidth is measured): scrollTop to current time / 08:00, scrollLeft to Monday of activeDate's week.
  const didInitialScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (!dayWidthReady || didInitialScrollRef.current) return
    const el = scrollContainerRef.current
    if (!el) return

    suppressScrollTracking()
    const hasToday = days.some((d) => d.isToday)
    const now = new Date()
    const targetHour = hasToday ? now.getHours() + now.getMinutes() / 60 : 8
    el.scrollTop = Math.max(0, targetHour * HOUR_HEIGHT - 16)

    const activeDay = days.find((d) => d.dateKey === activeDateKey)
    if (activeDay) {
      const weekStartKey = formatDateKey(startOfWeek(activeDay.date, { weekStartsOn: 1 }))
      const mondayIdx = days.findIndex((d) => d.dateKey === weekStartKey)
      if (mondayIdx !== -1) el.scrollLeft = mondayIdx * dayWidth
    }

    didInitialScrollRef.current = true
  }, [dayWidthReady, days, dayWidth, activeDateKey, scrollContainerRef])

  // Smooth-scroll the time grid so the current hour sits ~1/3 from the top.
  // Registered with the navigation context so the "Today" button / "t" shortcut
  // can jump to now (they only handle horizontal date nav on their own).
  const scrollToNow = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const now = new Date()
    const targetHour = now.getHours() + now.getMinutes() / 60
    el.scrollTo({
      top: Math.max(0, targetHour * HOUR_HEIGHT - el.clientHeight / 3),
      behavior: "smooth",
    })
  }, [scrollContainerRef])

  useEffect(() => {
    registerScrollToNow(scrollToNow)
    return () => registerScrollToNow(null)
  }, [registerScrollToNow, scrollToNow])

  // After initial scroll, whenever activeDate changes to an off-screen day, smooth-scroll it into view.
  // Deps are intentionally only activeDateKey — if we include `days` / `dayWidth`, the effect
  // re-fires on edge-growth and snaps the scroll back to activeDate, breaking free pan.
  const daysRef = useRef(days)
  const dayWidthRef = useRef(dayWidth)
  daysRef.current = days
  dayWidthRef.current = dayWidth

  // Track which day columns are scrolled into view, so the all-day region can
  // size itself to the visible days only (rAF-throttled; also runs on resize).
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const w = dayWidthRef.current
      if (!w) return
      const start = Math.max(0, Math.floor(el.scrollLeft / w))
      const end = start + Math.ceil((el.clientWidth - gutterWidth) / w)
      setVisibleCols((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollContainerRef, gutterWidth])

  useLayoutEffect(() => {
    if (!didInitialScrollRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    const currentDays = daysRef.current
    const currentDayWidth = dayWidthRef.current
    const idx = currentDays.findIndex((d) => d.dateKey === activeDateKey)
    if (idx === -1) return

    const columnLeft = gutterWidth + idx * currentDayWidth
    const columnRight = columnLeft + currentDayWidth
    const viewportLeft = el.scrollLeft + gutterWidth
    const viewportRight = el.scrollLeft + el.clientWidth

    if (columnLeft < viewportLeft - 1 || columnRight > viewportRight + 1) {
      suppressScrollTracking()
      el.scrollTo({ left: idx * currentDayWidth, behavior: "smooth" })
    }
  }, [activeDateKey, scrollContainerRef, gutterWidth])

  // When user stops scrolling, set activeDate to whatever day is the leftmost fully-visible column.
  const activeDateKeyRef = useRef(activeDateKey)
  activeDateKeyRef.current = activeDateKey
  const onScrollActiveChangeRef = useRef(onScrollActiveChange)
  onScrollActiveChangeRef.current = onScrollActiveChange
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let debounceTimer: number | null = null
    let lastScrollLeft = el.scrollLeft

    const onScroll = () => {
      if (Date.now() < ignoreScrollUntilRef.current) return
      if (el.scrollLeft === lastScrollLeft) return // vertical-only scroll
      lastScrollLeft = el.scrollLeft

      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        const currentDays = daysRef.current
        const currentDayWidth = dayWidthRef.current
        if (currentDayWidth === 0 || currentDays.length === 0) return
        const idx = Math.min(
          currentDays.length - 1,
          Math.max(0, Math.ceil(el.scrollLeft / currentDayWidth)),
        )
        const day = currentDays[idx]
        if (!day || day.dateKey === activeDateKeyRef.current) return
        onScrollActiveChangeRef.current(day.date)
      }, SCROLL_SETTLE_MS)
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    }
  }, [scrollContainerRef])

  const openCreatePopover = (
    day: Date,
    el: HTMLElement,
    opts: { allDay: boolean; startMinutes?: number; endMinutes?: number; clickY?: number },
  ) => {
    if (!canCreate) {
      promptToConnect()
      return
    }
    const tzid = getLocalTzid()
    let start: EventTime
    let end: EventTime
    if (opts.allDay) {
      start = allDayFromLocalDate(day)
      end = addDays(start, 1)
    } else {
      const startMin = opts.startMinutes ?? 0
      const endMin = opts.endMinutes ?? startMin + DEFAULT_SLOT_MINUTES
      const dayStartMs = startOfDay(day).getTime()
      start = fromDate(new Date(dayStartMs + startMin * 60_000), tzid)
      end = fromDate(new Date(dayStartMs + endMin * 60_000), tzid)
    }

    setActiveEventKey(null)
    setIsDrafting(false)
    setDraftEvent({
      summary: "",
      description: null,
      start,
      end,
      calendarId: defaultCalendarId,
      location: null,
      recurrence: null,
      attendees: [],
    })

    if (opts.clickY != null) {
      const { left, width } = el.getBoundingClientRect()
      const y = opts.clickY
      setDraftAnchor({ getBoundingClientRect: () => new DOMRect(left, y, width, 0) })
    } else {
      setDraftAnchor(el)
    }
    setDraftPopoverOpen(true)
  }

  // Minutes-from-midnight for a pointer position in a day column, snapped to
  // 15-minute increments and clamped to [0, max].
  const snapMinutesAtY = (el: HTMLElement, clientY: number, max = DAY_MINUTES) => {
    const rect = el.getBoundingClientRect()
    const fraction = (clientY - rect.top) / rect.height
    const snapped = Math.round((fraction * DAY_MINUTES) / 15) * 15
    return Math.max(0, Math.min(max, snapped))
  }

  // Live preview while click-dragging to create an event. `null` when idle.
  const [dragCreate, setDragCreate] = useState<{
    dayKey: string
    startMin: number
    endMin: number
  } | null>(null)
  const dragRef = useRef<{
    el: HTMLElement
    day: Date
    anchorMin: number
    startMin: number
    endMin: number
    clickY: number
  } | null>(null)

  // Was a popover open when the current press started? Captured on a window
  // capture-phase pointerdown — which runs *before* Radix dismisses the popover
  // (Radix closes on pointerdown, and React flushes that synchronously, so by
  // the time `mousedown` fires `draftPopoverOpen` already reads false). Reading
  // it here, earliest, lets the first click outside cancel instead of creating.
  const popoverOpenRef = useRef(false)
  popoverOpenRef.current = draftPopoverOpen || !!activeEvent
  const popoverOpenAtPressRef = useRef(false)
  useEffect(() => {
    const onPointerDown = () => {
      popoverOpenAtPressRef.current = popoverOpenRef.current
    }
    window.addEventListener("pointerdown", onPointerDown, { capture: true })
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true })
  }, [])

  // Mouse-down on an empty slot: begin a draft sized to the default slot, then
  // let dragging grow/shrink it in 15-minute steps. A plain click (no drag)
  // keeps the default length. The editor popover opens on release.
  const startDragCreate = (day: Date, e: React.MouseEvent<HTMLElement>) => {
    // Consume the "was a popover open at press" flag captured at pointerdown.
    const wasPopoverOpen = popoverOpenAtPressRef.current
    popoverOpenAtPressRef.current = false

    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("[data-event-clickable]")) return
    // First click outside an open popover just dismisses it — don't also start
    // creating another event.
    if (wasPopoverOpen) {
      setDraftPopoverOpen(false)
      setActiveEventKey(null)
      return
    }
    if (!canCreate) {
      promptToConnect()
      return
    }
    e.preventDefault()

    const el = e.currentTarget
    const anchorMin = snapMinutesAtY(el, e.clientY, DAY_MINUTES - DEFAULT_SLOT_MINUTES)
    dragRef.current = {
      el,
      day,
      anchorMin,
      startMin: anchorMin,
      endMin: anchorMin + DEFAULT_SLOT_MINUTES,
      clickY: e.clientY,
    }
    setDragCreate({
      dayKey: formatDateKey(day),
      startMin: anchorMin,
      endMin: anchorMin + DEFAULT_SLOT_MINUTES,
    })
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const cur = snapMinutesAtY(d.el, ev.clientY)
      let startMin: number
      let endMin: number
      if (cur === d.anchorMin) {
        // No real movement yet — keep the default-length slot.
        startMin = d.anchorMin
        endMin = d.anchorMin + DEFAULT_SLOT_MINUTES
      } else {
        startMin = Math.min(d.anchorMin, cur)
        endMin = Math.max(d.anchorMin, cur)
        if (endMin - startMin < 15) endMin = startMin + 15
      }
      d.startMin = startMin
      d.endMin = endMin
      setDragCreate({ dayKey: formatDateKey(d.day), startMin, endMin })
    }

    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
      const d = dragRef.current
      dragRef.current = null
      setDragCreate(null)
      if (!d) return
      openCreatePopover(d.day, d.el, {
        allDay: false,
        startMinutes: d.startMin,
        endMinutes: d.endMin,
        clickY: d.clickY,
      })
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const totalContentWidth = gutterWidth + N * dayWidth
  const dayGridCols = `${gutterWidth}px repeat(${N}, ${dayWidth}px)`

  return (
    <div ref={scrollContainerRef} className="h-full w-full min-w-0 overflow-auto">
      <div style={{ width: totalContentWidth, minHeight: "100%" }}>
        {/* Zone 1+2: Day headers + all-day bars share one grid so column tracks
            line up exactly with the time grid below. */}
        <div
          className="group sticky top-0 z-20 bg-background grid"
          style={{
            gridTemplateColumns: dayGridCols,
            gridTemplateRows: hasVisibleAllDay
              ? `auto repeat(${visibleAllDayLanes}, minmax(18px, auto))`
              : "auto",
          }}
        >
          {/* Gutter spacer — sticky left, spans all rows. Holds the all-day
              expand/collapse toggle when the region overflows. */}
          <div
            className="sticky left-0 z-30 bg-background border-r border-b border-divider relative"
            style={{ gridColumn: 1, gridRow: "1 / -1" }}
          >
            {/* Zone abbreviations, one per gutter column, aligned to the bottom
                of the day-header strip. */}
            <div className="absolute bottom-1 inset-x-0 flex">
              {gutterZones.map((tz) => (
                <span
                  key={tz}
                  className="text-[10px] text-muted-foreground text-right pr-1.5 truncate"
                  style={{ width: GUTTER_WIDTH }}
                  title={tz}
                >
                  {getZoneDisplayName(tz, timezoneLabels)}
                </span>
              ))}
            </div>
            {canCollapseAllDay && allDayExpanded && (
              <button
                type="button"
                onClick={() => setAllDayExpanded(false)}
                title="Show fewer"
                className={cn(
                  "absolute bottom-0 inset-x-0 h-[18px] flex items-center justify-center",
                  "text-muted-foreground cursor-default",
                  "hover:bg-secondary-hover transition-opacity",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <ChevronDownIcon className="size-3.5 rotate-180" />
              </button>
            )}
          </div>
          <DayHeaders
            days={days}
            activeDateKey={activeDateKey}
            dimmed={dimmed}
            onDayClick={onDayClick}
          />
          {hasVisibleAllDay && (
            <>
              {/* Per-day backgrounds for the all-day region */}
              {days.map((day, i) => (
                <AllDayContextMenu
                  key={`${day.dateKey}-allday-bg`}
                  onCreateEvent={() =>
                    openCreatePopover(day.date, contextTargetRef.current!, { allDay: true })
                  }
                >
                  <div
                    className={cn(
                      "border-r border-b border-divider",
                      day.dateKey === activeDateKey
                        ? "bg-secondary-hover"
                        : day.isWeekend && "bg-weekend",
                    )}
                    style={{ gridColumn: i + 2, gridRow: "2 / -1" }}
                    onContextMenu={(e) => {
                      contextTargetRef.current = e.currentTarget
                    }}
                  />
                </AllDayContextMenu>
              ))}
              {visibleAllDayItems.map((item) => {
                const key = eventKey(item.event)

                return (
                  <WeekAllDayBar
                    key={key}
                    item={item}
                    colOffset={1}
                    rowOffset={1}
                    gutterWidth={gutterWidth}
                    highlighted={key === activeEventKey || key === selectedEventKey}
                    isPending={isPendingEvent(item.event, calendars)}
                    isDeclined={isDeclinedEvent(item.event, calendars)}
                    isDraft={item.event === draftEvent}
                    dimmed={dimmed}
                    onClick={() => onEventClick(key)}
                  />
                )
              })}
              {/* Per-day "N more" tiles fill the final lane when collapsed.
                  Clicking any of them expands the whole all-day region. */}
              {hiddenByDay?.map((count, i) =>
                count > 0 ? (
                  <button
                    key={`${days[i].dateKey}-more`}
                    type="button"
                    onClick={() => setAllDayExpanded(true)}
                    className={cn(
                      "flex items-center px-1.5 text-[11px] text-muted-foreground numerical",
                      "truncate text-left rounded cursor-default hover:bg-secondary-hover",
                    )}
                    style={{ gridColumn: i + 2, gridRow: eventLaneCutoff + 2 }}
                  >
                    {count} more
                  </button>
                ) : null,
              )}
            </>
          )}
        </div>

        {/* Zone 3: Time grid (horizontally and vertically scrollable) */}
        <div
          className="grid relative"
          style={{ gridTemplateColumns: dayGridCols, height: GRID_HEIGHT }}
        >
          <div className="sticky left-0 z-10 bg-background border-r border-divider flex">
            {gutterZones.map((tz) => (
              <TimeGutter key={tz} timeFormat={timeFormat} tzid={tz} />
            ))}
          </div>
          {days.map((day) => (
            <ScheduledDayContextMenu
              key={day.dateKey}
              onCreateEvent={(el, clickY) => {
                const startMinutes = snapMinutesAtY(el, clickY, DAY_MINUTES - DEFAULT_SLOT_MINUTES)
                openCreatePopover(day.date, el, { allDay: false, startMinutes, clickY })
              }}
            >
              <div
                className={cn(
                  "relative border-r border-divider cursor-default",
                  day.dateKey === activeDateKey
                    ? "bg-secondary-hover"
                    : day.isWeekend && "bg-weekend",
                )}
                style={
                  {
                    "--day-bg":
                      day.dateKey === activeDateKey
                        ? "var(--secondary-hover)"
                        : day.isWeekend
                          ? "var(--weekend)"
                          : "var(--background)",
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, var(--divider) ${HOUR_HEIGHT - 1}px, var(--divider) ${HOUR_HEIGHT}px)`,
                  } as React.CSSProperties
                }
                onMouseDown={(e) => startDragCreate(day.date, e)}
              >
                {dragCreate?.dayKey === day.dateKey && (
                  <DragCreatePreview
                    startMin={dragCreate.startMin}
                    endMin={dragCreate.endMin}
                    timeFormat={timeFormat}
                  />
                )}
                {(timedByDay.get(day.dateKey) ?? []).map((layout) => {
                  const key = eventKey(layout.event)

                  return (
                    <WeekTimedEvent
                      key={key}
                      layout={layout}
                      highlighted={key === activeEventKey || key === selectedEventKey}
                      isPending={isPendingEvent(layout.event, calendars)}
                      isDeclined={isDeclinedEvent(layout.event, calendars)}
                      isDraft={layout.event === draftEvent}
                      dimmed={dimmed}
                      onEventClick={onEventClick}
                    />
                  )
                })}

                {day.isToday && <CurrentTimeIndicator />}
              </div>
            </ScheduledDayContextMenu>
          ))}
        </div>
      </div>
    </div>
  )
}

// Live block shown while click-dragging to create an event.
function DragCreatePreview({
  startMin,
  endMin,
  timeFormat,
}: {
  startMin: number
  endMin: number
  timeFormat: TimeFormat
}) {
  const top = (startMin / DAY_MINUTES) * 100
  const height = ((endMin - startMin) / DAY_MINUTES) * 100
  const label =
    `${formatWallclockTime(Math.floor(startMin / 60), startMin % 60, timeFormat)} – ` +
    `${formatWallclockTime(Math.floor(endMin / 60) % 24, endMin % 60, timeFormat)}`
  return (
    <div
      className="absolute left-0.5 right-1 z-10 rounded px-1 py-px overflow-hidden pointer-events-none bg-primary/30 border border-primary text-foreground"
      style={{ top: `${top}%`, height: `${height}%` }}
    >
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </div>
  )
}

// One hour-label column for a single zone. Each gridline `h` marks local hour
// `h`; the label is that instant rendered in `tzid`, so other zones show their
// own (possibly offset/half-hour) wall-clock time.
function TimeGutter({ timeFormat, tzid }: { timeFormat: TimeFormat; tzid: string }) {
  const fmt = new Intl.DateTimeFormat(timeFormat === "12h" ? "en-US" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: timeFormat === "12h" ? "h12" : "h23",
    timeZone: tzid,
  })
  return (
    <div className="relative shrink-0" style={{ height: GRID_HEIGHT, width: GUTTER_WIDTH }}>
      {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => {
        const d = new Date()
        d.setHours(h, 0, 0, 0)
        return (
          <span
            key={h}
            className="absolute right-1.5 text-[11px] text-muted-foreground numerical leading-none -translate-y-1/2 select-none"
            style={{ top: h * HOUR_HEIGHT }}
          >
            {fmt.format(d)}
          </span>
        )
      })}
    </div>
  )
}

const DayHeaders = ({
  days,
  activeDateKey,
  dimmed,
  onDayClick,
}: {
  days: MonthDay[]
  activeDateKey: string
  dimmed: boolean
  onDayClick: (date: Date) => void
}) => {
  const weather = useWeather()

  return days.map((day) => {
    const w = weather.get(day.dateKey)
    return (
      <div
        key={day.dateKey}
        className={cn(
          "flex flex-col items-end border-r border-divider px-1.5 py-1 gap-0.5 cursor-default numerical",
          day.dateKey === activeDateKey ? "bg-secondary-hover" : day.isWeekend && "bg-weekend",
        )}
        style={{ gridRow: 1 }}
        onClick={() => onDayClick(day.date)}
      >
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] text-muted-foreground uppercase">
            {format(day.date, "EEE")}
          </span>
          <span
            className={cn(
              "text-[13px] font-medium w-7 h-7 flex items-center justify-center rounded-circle",
              day.isToday && "bg-today text-primary-foreground",
              dimmed && "opacity-50",
            )}
          >
            {format(day.date, "d")}
          </span>
        </div>

        {w && (
          <div
            className="flex items-center gap-1 text-[10px] text-muted-foreground leading-none"
            title={weatherCodeToLabel(w.code)}
          >
            <span className="text-sm leading-none">{weatherCodeToEmoji(w.code)}</span>
            <span>
              {w.tempMax}°/{w.tempMin}°
            </span>
          </div>
        )}
      </div>
    )
  })
}
