import { format } from "date-fns"
import { useEffect, useState } from "react"

import { RsvpBar } from "@/components/event-parts/inputs/RsvpBar"
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { rpc } from "@/rpc"
import type { ResponseStatus, TimeFormat } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useSync } from "@/contexts/SyncContext"

import { useBreakpoint } from "@/hooks/useBreakpoint"
import { eventKey, rpcToCalendarEvent, type CalendarEvent } from "@/lib/cal-events"
import { formatTime, toInteropDate } from "@/lib/event-time"
import { cn } from "@/lib/utils"

export function InvitesBadge({ persistent = false }: { persistent?: boolean }) {
  const { calendars } = useCalendars()
  const [invites, setInvites] = useState<CalendarEvent[]>([])

  useEffect(() => {
    const slugs = calendars.filter((c) => c.provider !== null).map((c) => c.slug)
    if (slugs.length === 0) return

    rpc.caldir
      .list_invites(slugs)
      .then((events) => setInvites(events.map(rpcToCalendarEvent)))
      .catch(console.error)
  }, [calendars])

  // Mirror pending invitations onto the system-tray icon (shows a dot).
  useEffect(() => {
    void rpc.platform.set_tray_pending(invites.length > 0)
  }, [invites.length])

  const isMd = useBreakpoint("md")
  const { timeFormat } = useSettings()
  const { syncCalendars } = useSync()

  // In the toolbar we hide the badge when there's nothing to respond to. The
  // sidebar variant is always shown (gray at 0, red when there are invites).
  if (invites.length === 0 && !persistent) return null

  const hasInvites = invites.length > 0

  const handleRsvp = async (invite: CalendarEvent, response: ResponseStatus) => {
    setInvites((prev) => prev.filter((i) => eventKey(i) !== eventKey(invite)))
    try {
      // Responding from the invites list applies to the whole invitation
      // (the series for a recurring event).
      await rpc.caldir.rsvp(invite.calendar_slug, invite.id, response, "all")
      void syncCalendars([invite.calendar_slug])
    } catch (e) {
      console.error("RSVP failed:", e)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Invitations"
          className={cn(
            "flex h-7 min-w-7 items-center justify-center rounded-circle px-2 text-xs font-medium cursor-pointer transition-colors",
            hasInvites
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-secondary text-muted-foreground hover:bg-secondary-hover",
          )}
        >
          {invites.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align={isMd ? "start" : "end"} collisionPadding={16} className="w-80 p-0">
        <PopoverArrow />
        <div className="p-3 font-medium text-sm border-b">Invitations</div>
        {hasInvites ? (
          <div className="max-h-80 overflow-y-auto">
            {invites.map((invite) => (
              <InviteCard
                key={eventKey(invite)}
                invite={invite}
                onRsvp={handleRsvp}
                timeFormat={timeFormat}
              />
            ))}
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No pending invitations.</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function InviteCard({
  invite,
  onRsvp,
  timeFormat,
}: {
  invite: CalendarEvent
  onRsvp: (invite: CalendarEvent, response: ResponseStatus) => void
  timeFormat: TimeFormat
}) {
  const organizerEmail = invite.organizer?.email ?? "Unknown"
  const organizerName = invite.organizer?.name ?? organizerEmail
  const initial = organizerName.charAt(0).toUpperCase()

  const startDate = toInteropDate(invite.start)
  const dateStr =
    invite.start.kind === "date"
      ? format(startDate, "EEE, d MMM")
      : `${format(startDate, "EEE, d MMM")} ${formatTime(invite.start, timeFormat)}`

  return (
    <div className="flex flex-col border-b last:border-b-0">
      <div className="flex gap-3 p-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-circle text-xs font-medium text-white bg-muted-foreground",
          )}
        >
          {initial}
        </span>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm truncate">{invite.summary}</span>
            <span className="text-xs text-muted-foreground truncate">From: {organizerEmail}</span>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
        </div>
      </div>

      <div className="pt-0">
        <RsvpBar onRsvp={(response) => onRsvp(invite, response)} />
      </div>
    </div>
  )
}
