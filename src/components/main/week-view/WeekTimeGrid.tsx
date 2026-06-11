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
import { ScheduledDayContextMenu } from "./ScheduledDayContextMenu"

// Hour-row height adapts to the viewport: taller windows get roomy rows (up to
// MAX), shorter windows compress them (down to MIN) so more of the day fits
// before scrolling. Sized so ~TARGET_VISIBLE_HOURS fit in the viewport.
const MIN_HOUR_HEIGHT = 40
const MAX_HOUR_HEIGHT = 96
const TARGET_VISIBLE_HOURS = 12
export const GUTTER_WIDTH = 48
const DAY_WIDTH_MIN = 100

function computeHourHeight(viewportHeight: number): number {
  const h = Math.round(viewportHeight / TARGET_VISIBLE_HOURS)
  return Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, h))
}

// The current-time line/dot/labels are always this red, regardless of theme.
const NOW_LINE_COLOR = "#D33A30"

const DAY_MINUTES = 24 * 60
// Default duration for an event created by clicking an empty time slot.
const DEFAULT_SLOT_MINUTES = 60

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
  /** How many day columns fit in the viewport (Week = 7, 3-Day = 3). */
  visibleDays?: number
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
  visibleDays = 7,
}: WeekTimeGridProps) {
  const { calendars } = useCalendars()
  const { registerScrollToNow, setNowLineVisible } = useCalendarNavigation()
  const { activeEvent, setActiveEventKey } = useCalEvents()
  const { draftPopoverOpen, setDraftEvent, setDraftPopoverOpen, setIsDrafting, defaultCalendarId } =
    useEventDraft()
  const { canCreate, promptToConnect } = useCreateEventGate()
  const { timeFormat, extraTimezones, timezoneLabels, allDayVisibleCount } = useSettings()

  // Gutter holds one hour-label column per zone: the extra zones first, then the
  // local zone closest to the grid (matches Google Calendar). Width scales with
  // the number of columns.
  // Local zone in the left gutter; extra zones in a right gutter (matches
  // Notion/Cron — secondary zones on the right edge).
  const leftZone = getLocalTzid()
  const rightZones = extraTimezones
  const leftGutterWidth = GUTTER_WIDTH
  const rightGutterWidth = GUTTER_WIDTH * rightZones.length

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
  // How many all-day lanes to show before collapsing (user-configurable).
  const collapsedLanes = allDayVisibleCount
  const canCollapseAllDay = visibleAllDayLaneCount > collapsedLanes
  const allDayCollapsed = canCollapseAllDay && !allDayExpanded
  // Collapsed grid = (event lanes) + (1 "more" row). Expanded = all visible lanes.
  const visibleAllDayLanes = allDayCollapsed ? collapsedLanes : visibleAllDayLaneCount
  const hasVisibleAllDay = hasAllDay && visibleAllDayLanes > 0
  const eventLaneCutoff = allDayCollapsed ? collapsedLanes - 1 : visibleAllDayLaneCount
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
  const [hourHeight, setHourHeight] = useState(MAX_HOUR_HEIGHT)
  const hourHeightRef = useRef(hourHeight)
  hourHeightRef.current = hourHeight
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const update = () => {
      const w = Math.max(
        DAY_WIDTH_MIN,
        (el.clientWidth - leftGutterWidth - rightGutterWidth) / visibleDays,
      )
      setDayWidth(w)
      setHourHeight(computeHourHeight(el.clientHeight))
      setDayWidthReady(true)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollContainerRef, leftGutterWidth, rightGutterWidth, visibleDays])

  const gridHeight = 24 * hourHeight

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
    // When today is in view, center the now-line vertically; otherwise show
    // 8:00 near the top.
    el.scrollTop = hasToday
      ? Math.max(0, targetHour * hourHeightRef.current - el.clientHeight / 2)
      : Math.max(0, targetHour * hourHeightRef.current - 16)

    const activeDay = days.find((d) => d.dateKey === activeDateKey)
    if (activeDay) {
      // Week view anchors the viewport on the Monday of the active week; the
      // narrower 3-Day view anchors directly on the active day instead.
      if (visibleDays >= 7) {
        const weekStartKey = formatDateKey(startOfWeek(activeDay.date, { weekStartsOn: 1 }))
        const mondayIdx = days.findIndex((d) => d.dateKey === weekStartKey)
        if (mondayIdx !== -1) el.scrollLeft = mondayIdx * dayWidth
      } else {
        const activeIdx = days.findIndex((d) => d.dateKey === activeDateKey)
        if (activeIdx !== -1) el.scrollLeft = activeIdx * dayWidth
      }
    }

    didInitialScrollRef.current = true
  }, [dayWidthReady, days, dayWidth, activeDateKey, scrollContainerRef, visibleDays])

  // Smooth-scroll the time grid so the current time sits centered vertically.
  // Registered with the navigation context so the "Today" button / "t" shortcut
  // can jump to now (they only handle horizontal date nav on their own).
  const scrollToNow = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const now = new Date()
    const targetHour = now.getHours() + now.getMinutes() / 60
    el.scrollTo({
      top: Math.max(0, targetHour * hourHeightRef.current - el.clientHeight / 2),
      behavior: "smooth",
    })
  }, [scrollContainerRef])

  useEffect(() => {
    registerScrollToNow(scrollToNow)
    return () => registerScrollToNow(null)
  }, [registerScrollToNow, scrollToNow])

  // Report whether the current-time line is within the vertical viewport, so the
  // header's Today button can switch to "Focus on Now" when it's scrolled away.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const compute = () => {
      const hasToday = daysRef.current.some((d) => d.isToday)
      if (!hasToday) {
        setNowLineVisible(false)
        return
      }
      const now = new Date()
      const nowY = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourHeightRef.current
      const visible = nowY >= el.scrollTop + 8 && nowY <= el.scrollTop + el.clientHeight - 8
      setNowLineVisible(visible)
    }
    compute()
    let raf = 0
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          compute()
        })
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    const interval = window.setInterval(compute, 60_000)
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      window.clearInterval(interval)
      if (raf) cancelAnimationFrame(raf)
      setNowLineVisible(false)
    }
  }, [scrollContainerRef, setNowLineVisible])

  // Re-center the now-line whenever the app regains focus or becomes visible —
  // time moves on between opens, so reopening always shows it centered.
  useEffect(() => {
    const recenter = () => {
      if (document.visibilityState === "hidden") return
      scrollToNow()
    }
    window.addEventListener("focus", recenter)
    document.addEventListener("visibilitychange", recenter)
    return () => {
      window.removeEventListener("focus", recenter)
      document.removeEventListener("visibilitychange", recenter)
    }
  }, [scrollToNow])

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
      const end = start + Math.ceil((el.clientWidth - leftGutterWidth - rightGutterWidth) / w)
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
  }, [scrollContainerRef, leftGutterWidth, rightGutterWidth])

  useLayoutEffect(() => {
    if (!didInitialScrollRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    const currentDays = daysRef.current
    const currentDayWidth = dayWidthRef.current
    const idx = currentDays.findIndex((d) => d.dateKey === activeDateKey)
    if (idx === -1) return

    const columnLeft = leftGutterWidth + idx * currentDayWidth
    const columnRight = columnLeft + currentDayWidth
    const viewportLeft = el.scrollLeft + leftGutterWidth
    const viewportRight = el.scrollLeft + el.clientWidth

    if (columnLeft < viewportLeft - 1 || columnRight > viewportRight + 1) {
      // Bring it into view anchored the same way as the initial scroll: week
      // view pins the active day's week (its Monday) so the whole week shows
      // with today in place; the narrow 3-Day view pins the active day itself.
      let targetIdx = idx
      if (visibleDays >= 7) {
        const weekStartKey = formatDateKey(startOfWeek(currentDays[idx].date, { weekStartsOn: 1 }))
        const mondayIdx = currentDays.findIndex((d) => d.dateKey === weekStartKey)
        if (mondayIdx !== -1) targetIdx = mondayIdx
      }
      suppressScrollTracking()
      el.scrollTo({ left: targetIdx * currentDayWidth, behavior: "smooth" })
    }
  }, [activeDateKey, scrollContainerRef, leftGutterWidth, visibleDays])

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

  // Re-anchor on resize. When the window width changes, `dayWidth` changes but
  // `scrollLeft` (a pixel offset) does not — so the same offset would land on a
  // different day, shifting "today" rightward or jumping to another week. After
  // each width change we re-pin the viewport to the active day (Monday of its
  // week in week view), suppressing scroll tracking so activeDate doesn't drift.
  const prevAnchorDayWidthRef = useRef(dayWidth)
  useLayoutEffect(() => {
    if (prevAnchorDayWidthRef.current === dayWidth) return
    prevAnchorDayWidthRef.current = dayWidth
    if (!didInitialScrollRef.current) return
    const el = scrollContainerRef.current
    if (!el) return

    const currentDays = daysRef.current
    const activeDay = currentDays.find((d) => d.dateKey === activeDateKeyRef.current)
    if (!activeDay) return

    let idx: number
    if (visibleDays >= 7) {
      const weekStartKey = formatDateKey(startOfWeek(activeDay.date, { weekStartsOn: 1 }))
      idx = currentDays.findIndex((d) => d.dateKey === weekStartKey)
    } else {
      idx = currentDays.findIndex((d) => d.dateKey === activeDay.dateKey)
    }
    if (idx === -1) return

    suppressScrollTracking()
    el.scrollLeft = idx * dayWidth
  }, [dayWidth, visibleDays, scrollContainerRef])

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
    moved: boolean
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
      moved: false,
    }
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const cur = snapMinutesAtY(d.el, ev.clientY)
      if (cur === d.anchorMin && !d.moved) return // not a drag yet
      const startMin = Math.min(d.anchorMin, cur)
      let endMin = Math.max(d.anchorMin, cur)
      if (endMin - startMin < 15) endMin = startMin + 15
      d.startMin = startMin
      d.endMin = endMin
      d.moved = true
      // The dragged selection preview only appears once an actual drag starts.
      setDragCreate({ dayKey: formatDateKey(d.day), startMin, endMin })
    }

    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
      const d = dragRef.current
      dragRef.current = null
      setDragCreate(null)
      // Only a real drag creates here; a plain single click does nothing
      // (double-click creates a default slot — see onDoubleClick below).
      if (!d || !d.moved) return
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

  // Double-click an empty slot to create a default-length event there.
  const handleDoubleClickCreate = (day: Date, e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("[data-event-clickable]")) return
    if (!canCreate) {
      promptToConnect()
      return
    }
    const el = e.currentTarget
    const startMinutes = snapMinutesAtY(el, e.clientY, DAY_MINUTES - DEFAULT_SLOT_MINUTES)
    openCreatePopover(day, el, { allDay: false, startMinutes, clickY: e.clientY })
  }

  const totalContentWidth = leftGutterWidth + N * dayWidth + rightGutterWidth
  const dayGridCols = `${leftGutterWidth}px repeat(${N}, ${dayWidth}px) ${rightGutterWidth}px`

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
            {/* Local zone label, aligned to the bottom of the day-header strip. */}
            <div className="absolute bottom-1 inset-x-0 flex">
              <span
                className="text-[10px] text-muted-foreground text-right pr-1.5 truncate"
                style={{ width: GUTTER_WIDTH }}
                title={leftZone}
              >
                {getZoneDisplayName(leftZone, timezoneLabels)}
              </span>
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
          {rightZones.length > 0 && (
            <div
              className="sticky right-0 z-30 bg-background border-l border-b border-divider relative"
              style={{ gridColumn: N + 2, gridRow: "1 / -1" }}
            >
              <div className="absolute bottom-1 inset-x-0 flex">
                {rightZones.map((tz) => (
                  <span
                    key={tz}
                    className="text-[10px] text-muted-foreground text-left pl-1.5 truncate"
                    style={{ width: GUTTER_WIDTH }}
                    title={tz}
                  >
                    {getZoneDisplayName(tz, timezoneLabels)}
                  </span>
                ))}
              </div>
            </div>
          )}
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
                      day.isToday
                        ? "bg-today/8"
                        : day.dateKey === activeDateKey
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
                    gutterWidth={leftGutterWidth}
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
          style={{ gridTemplateColumns: dayGridCols, height: gridHeight }}
        >
          <div className="sticky left-0 z-10 bg-background border-r border-divider flex">
            <TimeGutter
              timeFormat={timeFormat}
              tzid={leftZone}
              hourHeight={hourHeight}
              gridHeight={gridHeight}
              align="right"
            />
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
                  // Today gets a tint of the accent (today) color so it's
                  // distinct from the neutral weekend / selected-day shading.
                  day.isToday
                    ? "bg-today/8"
                    : day.dateKey === activeDateKey
                      ? "bg-secondary-hover"
                      : day.isWeekend && "bg-weekend",
                )}
                style={
                  {
                    "--day-bg": day.isToday
                      ? "color-mix(in srgb, var(--today) 8%, var(--background))"
                      : day.dateKey === activeDateKey
                        ? "var(--secondary-hover)"
                        : day.isWeekend
                          ? "var(--weekend)"
                          : "var(--background)",
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourHeight - 1}px, var(--divider) ${hourHeight - 1}px, var(--divider) ${hourHeight}px)`,
                  } as React.CSSProperties
                }
                onMouseDown={(e) => startDragCreate(day.date, e)}
                onDoubleClick={(e) => handleDoubleClickCreate(day.date, e)}
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
                      hourHeight={hourHeight}
                      highlighted={key === activeEventKey || key === selectedEventKey}
                      isPending={isPendingEvent(layout.event, calendars)}
                      isDeclined={isDeclinedEvent(layout.event, calendars)}
                      isDraft={layout.event === draftEvent}
                      dimmed={dimmed}
                      onEventClick={onEventClick}
                    />
                  )
                })}
              </div>
            </ScheduledDayContextMenu>
          ))}

          {/* Right gutter: extra-zone hour labels, sticky to the right edge. */}
          {rightZones.length > 0 && (
            <div
              className="sticky right-0 z-10 bg-background border-l border-divider flex"
              style={{ gridColumn: N + 2 }}
            >
              {rightZones.map((tz) => (
                <TimeGutter
                  key={tz}
                  timeFormat={timeFormat}
                  tzid={tz}
                  hourHeight={hourHeight}
                  gridHeight={gridHeight}
                  align="left"
                />
              ))}
            </div>
          )}

          {/* One continuous now-line across all day columns, with the current
              time in the left gutter (local) and right gutter (extra zones). */}
          <NowLine
            timeFormat={timeFormat}
            leftZone={leftZone}
            rightZones={rightZones}
            leftGutterWidth={leftGutterWidth}
            rightGutterWidth={rightGutterWidth}
            todayIndex={days.findIndex((d) => d.isToday)}
            dayWidth={dayWidth}
          />
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

// One continuous current-time line spanning all day columns. The time shows in
// the left gutter (local zone) and, when present, the right gutter (extra zones).
function NowLine({
  timeFormat,
  leftZone,
  rightZones,
  leftGutterWidth,
  rightGutterWidth,
  todayIndex,
  dayWidth,
}: {
  timeFormat: TimeFormat
  leftZone: string
  rightZones: string[]
  leftGutterWidth: number
  rightGutterWidth: number
  todayIndex: number
  dayWidth: number
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const topPct = ((now.getHours() * 60 + now.getMinutes()) / DAY_MINUTES) * 100
  // Live time keeps the minutes (e.g. "12:46").
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: timeFormat === "12h" ? "h12" : "h23",
      timeZone: tz,
    }).format(now)

  // Dot sits at the left edge of today's column (relative to the line layer,
  // which starts at the left gutter edge), if today is in view. When today is
  // the leftmost column, nudge it right by its radius (+ the line's gap) so the
  // whole dot stays clear of the sticky time gutter instead of being half-hidden.
  const dotLeft = todayIndex >= 0 ? Math.max(todayIndex * dayWidth, 6) : null

  return (
    <>
      {/* Line + dot: spans only the day-column area, and sits BELOW the sticky
          gutters (z < the gutters' z-10) so the opaque gutters cover its ends —
          the line never draws over the time-zone columns, even when scrolled. */}
      <div
        className="absolute z-[9] pointer-events-none"
        style={{
          top: `${topPct}%`,
          left: leftGutterWidth,
          right: rightGutterWidth,
          transform: "translateY(-50%)",
        }}
      >
        {/* small gap before each gutter */}
        <div className="border-t mx-1.5" style={{ borderColor: NOW_LINE_COLOR }} />
        {dotLeft !== null && (
          <span
            className="absolute size-2.5 rounded-full"
            style={{
              left: dotLeft,
              top: 0,
              transform: "translate(-50%, -50%)",
              backgroundColor: NOW_LINE_COLOR,
            }}
          />
        )}
      </div>

      {/* Time labels: sit in the gutters ABOVE everything (z > the gutters). */}
      <div
        className="absolute inset-x-0 z-30 flex items-center pointer-events-none"
        style={{ top: `${topPct}%`, transform: "translateY(-50%)" }}
      >
        <span
          className="sticky left-0 shrink-0 pr-1 text-right text-[10px] font-semibold numerical leading-none bg-background"
          style={{ width: leftGutterWidth, color: NOW_LINE_COLOR }}
        >
          {fmt(leftZone)}
        </span>
        <div className="grow" />
        {rightZones.length > 0 && (
          <div
            className="sticky right-0 flex shrink-0 bg-background"
            style={{ width: rightGutterWidth }}
          >
            {rightZones.map((tz) => (
              <span
                key={tz}
                className="pl-1.5 text-left text-[10px] font-semibold numerical leading-none"
                style={{ width: GUTTER_WIDTH, color: NOW_LINE_COLOR }}
              >
                {fmt(tz)}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// One hour-label column for a single zone. Each gridline `h` marks local hour
// `h`; the label is that instant rendered in `tzid`, so other zones show their
// own (possibly offset/half-hour) wall-clock time.
function TimeGutter({
  timeFormat,
  tzid,
  hourHeight,
  gridHeight,
  align = "right",
}: {
  timeFormat: TimeFormat
  tzid: string
  hourHeight: number
  gridHeight: number
  align?: "left" | "right"
}) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: timeFormat === "12h" ? "h12" : "h23",
    timeZone: tzid,
  })
  // Gridlines are on the hour, so drop ":00" and show just the hour (e.g. "14",
  // "2 PM"). Half-hour-offset zones still show minutes (e.g. "14:30").
  const labelFor = (d: Date) => {
    const parts = fmt.formatToParts(d)
    const hour = parts.find((p) => p.type === "hour")?.value ?? ""
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
    const period = parts.find((p) => p.type === "dayPeriod")?.value
    const suffix = period ? ` ${period}` : ""
    return minute === "00" ? `${hour}${suffix}` : `${hour}:${minute}${suffix}`
  }
  return (
    <div className="relative shrink-0" style={{ height: gridHeight, width: GUTTER_WIDTH }}>
      {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => {
        const d = new Date()
        d.setHours(h, 0, 0, 0)
        return (
          <span
            key={h}
            className={cn(
              "absolute text-[11px] text-muted-foreground numerical leading-none -translate-y-1/2 select-none",
              align === "left" ? "left-1.5" : "right-1.5",
            )}
            style={{ top: h * hourHeight }}
          >
            {labelFor(d)}
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
          day.isToday
            ? "bg-today/8"
            : day.dateKey === activeDateKey
              ? "bg-secondary-hover"
              : day.isWeekend && "bg-weekend",
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
