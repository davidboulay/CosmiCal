import { memo, useRef, useState } from "react"

import { EventContextMenu } from "@/components/EventContextMenu"
import { UntitledEventText } from "@/components/ui/untitled-event-text"

import { useSettings } from "@/contexts/SettingsContext"

import type { WeekTimedEventLayout } from "@/hooks/cal-events/useDayRangeLayout"
import { eventKey } from "@/lib/cal-events"
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

function WeekTimedEventImpl({
  layout,
  hourHeight,
  highlighted: highlightedByParent,
  isPending,
  isDeclined,
  isDraft,
  dimmed,
  onEventClick,
}: {
  layout: WeekTimedEventLayout
  hourHeight: number
  highlighted: boolean
  isPending: boolean
  isDeclined: boolean
  isDraft: boolean
  dimmed: boolean
  onEventClick: (eventKey: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const { timeFormat } = useSettings()

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

  const inner = (
    <div
      ref={ref}
      data-event-clickable={!isDraft || undefined}
      className={cn(
        getEventBlockClasses(highlighted, isDeclined),
        "absolute overflow-hidden rounded px-1",
        hasStripe && "pl-1.5",
        !isDraft && dimmed && "opacity-50",
        isDraft && "font-medium",
      )}
      style={{
        top: `${layout.top}%`,
        height: `max(${layout.height}%, 1rem)`,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        zIndex: layout.column,
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
      onClick={
        isDraft
          ? undefined
          : (e) => {
              e.stopPropagation()
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
