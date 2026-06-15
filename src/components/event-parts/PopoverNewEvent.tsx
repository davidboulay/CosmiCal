import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

import { useCalEvents } from "@/contexts/CalEventsContext"
import { useEventDraft } from "@/contexts/EventDraftContext"

import { getDraftAnchor } from "@/lib/draft-anchor"

import { ComposeEventInner } from "./ComposeEvent"
import { useEventPopoverTabTrap } from "./useEventPopoverTabTrap"

export function PopoverNewEvent() {
  const {
    draftPopoverOpen,
    setDraftPopoverOpen,
    draftEvent,
    confirmDiscardOpen,
    requestCloseDraft,
    discardDraft,
    confirmAddDraft,
  } = useEventDraft()
  const { activeEvent } = useCalEvents()
  const anchorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLTextAreaElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useLayoutEffect(() => {
    if (!draftPopoverOpen) return

    const anchor = getDraftAnchor()
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    setPos({ top: rect.top + rect.height / 2, left: rect.left, width: rect.width })
  }, [draftPopoverOpen])

  // Focus the summary textarea after the context menu finishes restoring focus
  useEffect(() => {
    if (!draftPopoverOpen) return
    const timer = setTimeout(() => {
      summaryRef.current?.focus()
    }, 300)
    return () => clearTimeout(timer)
  }, [draftPopoverOpen])

  // Auto-close if edit popover opens (mutual exclusion)
  useEffect(() => {
    if (activeEvent && draftPopoverOpen) {
      setDraftPopoverOpen(false)
    }
  }, [activeEvent])

  useEventPopoverTabTrap({ enabled: draftPopoverOpen, contentRef })

  return (
    <Popover
      open={draftPopoverOpen}
      onOpenChange={(open) => {
        if (!open) requestCloseDraft()
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
          // Don't dismiss when interacting with a portaled Select dropdown
          // (calendar/repeat/reminder) inside the compose form.
          if (target.closest("[data-radix-popper-content-wrapper],[role='listbox']")) {
            e.preventDefault()
            return
          }
          if (target.closest("[data-event-clickable]")) {
            e.preventDefault()
          } else {
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
          e.preventDefault()
        }}
      >
        <ComposeEventInner
          summaryRef={summaryRef}
          onCreated={() => setDraftPopoverOpen(false)}
          onCancel={() => setDraftPopoverOpen(false)}
        />
      </PopoverContent>

      <Dialog open={confirmDiscardOpen} onOpenChange={(o) => !o && discardDraft()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add this event?</DialogTitle>
            <DialogDescription>
              You started creating "{draftEvent.summary?.trim() || "Untitled"}". Add it to your
              calendar, or discard it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={discardDraft}>
              Discard
            </Button>
            <Button onClick={confirmAddDraft}>Add event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  )
}
