import { useLayoutEffect, useRef, useState } from "react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

import { useCalEvents } from "@/contexts/CalEventsContext"
import { useRecurrenceEdit } from "@/contexts/RecurrenceEditContext"

import { getEventAnchor } from "@/lib/event-anchor"

import { EditEvent } from "./EditEvent"
import { useEventPopoverTabTrap } from "./useEventPopoverTabTrap"

export function PopoverEditEvent() {
  const { activeEvent, setActiveEventKey } = useCalEvents()
  const { requestSave } = useRecurrenceEdit()
  const anchorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useLayoutEffect(() => {
    if (!activeEvent) return

    const el = getEventAnchor()
    if (!el) return

    const rect = el.getBoundingClientRect()
    setPos({ top: rect.top + rect.height / 2, left: rect.left, width: rect.width })
  }, [activeEvent])

  useEventPopoverTabTrap({ enabled: !!activeEvent, contentRef })

  return (
    <Popover
      open={!!activeEvent}
      onOpenChange={(open) => {
        if (!open) setActiveEventKey(null)
      }}
    >
      <PopoverAnchor
        ref={anchorRef}
        className="fixed pointer-events-none"
        style={{ top: pos.top, left: pos.left, width: pos.width, height: 0 }}
      />
      <PopoverContent
        ref={contentRef}
        className="w-[350px] max-h-[80vh] overflow-y-auto p-0 shadow-2xl"
        side="right"
        align="center"
        sideOffset={8}
        collisionPadding={16}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement
          // Clicks inside a portaled popper (the calendar/repeat/reminder
          // Select dropdowns render outside the popover DOM) must NOT dismiss
          // the editor — otherwise choosing an option closes it before the
          // change is applied (e.g. moving an event to another calendar).
          if (target.closest("[data-radix-popper-content-wrapper],[role='listbox']")) {
            e.preventDefault()
            return
          }
          // If the click landed on an event element, let that element's
          // toggle handler manage the popover instead of auto-dismissing.
          if (target.closest("[data-event-clickable]")) {
            e.preventDefault()
          } else {
            // Swallow the click so it doesn't reach underlying elements
            // (e.g. day cells in the month view that would trigger navigation).
            window.addEventListener(
              "click",
              (ev) => {
                ev.stopPropagation()
                ev.preventDefault()
              },
              { capture: true, once: true },
            )
          }
        }}
        onFocusOutside={(e) => {
          // Never dismiss the popover due to focus moving elsewhere —
          // onPointerDownOutside and Escape already handle intentional closes.
          e.preventDefault()
        }}
      >
        <EditEvent event={activeEvent} onRequestSave={requestSave} />
      </PopoverContent>
    </Popover>
  )
}
