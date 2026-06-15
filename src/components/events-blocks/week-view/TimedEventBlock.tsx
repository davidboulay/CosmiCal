import { memo, useRef, useState } from "react"

import { EventContextMenu } from "@/components/EventContextMenu"
import { UntitledEventText } from "@/components/ui/untitled-event-text"

import { useSettings } from "@/contexts/SettingsContext"

import type { WeekTimedEventLayout } from "@/hooks/cal-events/useDayRangeLayout"
import { eventKey, type CalendarEvent } from "@/lib/cal-events"
import { setEventAnchor } from "@/lib/event-anchor"
import { getEventBlockClasses, getEventBlockColors, getEventBlockStyle } from "@/lib/event-styles"
import { formatTime } from "@/lib/event-time"
import { cn } from "@/lib/utils"

// Single, constant font for every timed block — we adapt the *layout* (one line
// vs. time + multi-line title) to the available height rather than scaling type.
const LINE_PX = 16 // text-xs line height (leading-tight)
const PAD_PX = 4 // vertical padding inside the block
const MIN_BLOCK_PX = 16
// Below this height there's no room for a separate time line, so the start time
// shares one line with the (truncated) title.
const TWO_LINE_MIN_PX = 2 * LINE_PX + PAD_PX

const DAY_MIN = 24 * 60
const SNAP_MIN = 15

function WeekTimedEventImpl({
  layout,
  hourHeight,
  highlighted: highlightedByParent,
  isPending,
  isDeclined,
  isDraft,
  dimmed,
  onEventClick,
  onTimeChange,
}: {
  layout: WeekTimedEventLayout
  hourHeight: number
  highlighted: boolean
  isPending: boolean
  isDeclined: boolean
  isDraft: boolean
  dimmed: boolean
  onEventClick: (eventKey: string) => void
  /** When provided, the block can be dragged to move and its edge dragged to
   * resize; reports the new start/end minutes-of-day. Omitted for events that
   * can't be edited (read-only calendars, invites you don't organize). */
  onTimeChange?: (event: CalendarEvent, newStartMin: number, newEndMin: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const { timeFormat } = useSettings()

  // Live drag offsets (minutes); null when not dragging.
  const [dragDelta, setDragDelta] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<{ start: number; end: number; moved: boolean } | null>(null)
  const justDraggedRef = useRef(false)

  const baseStartMin = Math.round((layout.top / 100) * DAY_MIN)
  const baseEndMin = baseStartMin + layout.durationMinutes

  const beginDrag = (mode: "move" | "resize", e: React.MouseEvent) => {
    if (!onTimeChange || e.button !== 0) return
    e.stopPropagation()
    const startY = e.clientY
    const pxPerMin = hourHeight / 60
    dragRef.current = { start: 0, end: 0, moved: false }

    const onMove = (ev: MouseEvent) => {
      const st = dragRef.current
      if (!st) return
      const dyMin = Math.round((ev.clientY - startY) / pxPerMin / SNAP_MIN) * SNAP_MIN
      if (dyMin !== 0) st.moved = true
      if (mode === "move") {
        // Clamp so the block stays within the day, keeping its duration.
        const delta = Math.max(-baseStartMin, Math.min(dyMin, DAY_MIN - baseEndMin))
        st.start = delta
        st.end = delta
      } else {
        // Resize the end; never shorter than one snap step or past midnight.
        const delta = Math.max(
          SNAP_MIN - layout.durationMinutes,
          Math.min(dyMin, DAY_MIN - baseEndMin),
        )
        st.start = 0
        st.end = delta
      }
      setDragDelta({ start: st.start, end: st.end })
    }

    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
      const st = dragRef.current
      dragRef.current = null
      setDragDelta(null)
      if (st && st.moved) {
        justDraggedRef.current = true // suppress the click that follows mouseup
        onTimeChange(layout.event, baseStartMin + st.start, baseEndMin + st.end)
      }
    }

    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // Cascade layout: each overlap depth indents from the left by a fixed percentage and
  // extends to the right edge, so the earlier/outer event remains fully visible beneath.
  const CASCADE_OFFSET_PCT = 15
  const leftPercent = layout.column * CASCADE_OFFSET_PCT
  const widthPercent = 100 - leftPercent

  const highlighted = highlightedByParent || contextOpen

  const colors = getEventBlockColors({
    calendarColor: layout.calendarColor,
    eventColor: layout.event.color,
    highlighted,
    isDraft,
  })

  // Declined/pending keep the normal filled look (with the colored accent bar);
  // declined adds a zebra overlay and pending is rendered semi-transparent.
  const hasStripe = !isDraft

  const summary = layout.event.summary || <UntitledEventText />
  const startTime = formatTime(layout.event.start, timeFormat)

  // Decide the layout from the block's actual rendered height (duration × the
  // current hour height), not just its duration — so a short block at any zoom
  // never clips text mid-line. Font size stays constant in all cases.
  const blockPx = Math.max(MIN_BLOCK_PX, (layout.durationMinutes / 60) * hourHeight)
  const oneLine = blockPx < TWO_LINE_MIN_PX
  const titleLines = Math.max(1, Math.floor((blockPx - PAD_PX - LINE_PX) / LINE_PX))

  const draggable = !!onTimeChange
  const effStartMin = baseStartMin + (dragDelta?.start ?? 0)
  const effEndMin = baseEndMin + (dragDelta?.end ?? 0)
  const topPct = (effStartMin / DAY_MIN) * 100
  const heightPct = ((effEndMin - effStartMin) / DAY_MIN) * 100

  // A draggable draft is also marked clickable so a press on it doesn't register
  // as "outside" and dismiss the compose popover mid-drag.
  const inner = (
    <div
      ref={ref}
      data-event-clickable={!isDraft || draggable || undefined}
      className={cn(
        getEventBlockClasses(highlighted, isDeclined),
        "absolute overflow-hidden rounded px-1",
        hasStripe && "pl-1.5",
        !isDraft && dimmed && "opacity-50",
        isDraft && "font-medium",
        draggable && "cursor-move",
        dragDelta && "shadow-lg ring-1 ring-black/10 z-50",
      )}
      style={{
        top: `${topPct}%`,
        height: `max(${heightPct}%, 1rem)`,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        zIndex: dragDelta ? 50 : layout.column,
        border: "1px solid var(--background)",
        ...getEventBlockStyle({
          calendarColor: layout.calendarColor,
          eventColor: layout.event.color,
          highlighted,
          isDraft,
          isDeclined,
          isPending,
        }),
      }}
      onMouseDown={draggable ? (e) => beginDrag("move", e) : undefined}
      onClick={
        isDraft
          ? undefined
          : (e) => {
              e.stopPropagation()
              // Don't open the editor when the press was a drag.
              if (justDraggedRef.current) {
                justDraggedRef.current = false
                return
              }
              setEventAnchor(e.currentTarget)
              onEventClick(eventKey(layout.event))
            }
      }
    >
      {hasStripe && (
        <div
          className={cn("absolute left-0 top-0 bottom-0 w-[2px]")}
          style={{ backgroundColor: colors.borderColor }}
        />
      )}

      {draggable && (
        // Bottom-edge grab zone to resize the event's duration.
        <div
          className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
          onMouseDown={(e) => beginDrag("resize", e)}
        />
      )}

      {oneLine ? (
        // Not enough height for two lines: start time + the beginning of the
        // title on a single line, ellipsised if it overflows.
        <div className="flex items-baseline gap-1 overflow-hidden text-xs leading-tight">
          <span className="shrink-0 opacity-80">{startTime}</span>
          <span className="truncate font-semibold">{summary}</span>
        </div>
      ) : (
        // Start time on its own line, then the title across as many lines as
        // fit (computed from the block height), ellipsised at the last line.
        <div className="py-0.5 text-xs leading-tight overflow-hidden">
          <div className="opacity-80">{startTime}</div>
          <div
            className="font-semibold overflow-hidden"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: titleLines,
            }}
          >
            {summary}
          </div>
        </div>
      )}
    </div>
  )

  if (isDraft) return inner

  return (
    <EventContextMenu event={layout.event} anchorRef={ref} onOpenChange={setContextOpen}>
      {inner}
    </EventContextMenu>
  )
}

export const WeekTimedEvent = memo(WeekTimedEventImpl)
