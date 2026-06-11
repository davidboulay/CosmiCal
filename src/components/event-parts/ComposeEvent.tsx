import { type Ref, useCallback, useEffect, useState } from "react"
import { rrulestr } from "rrule"

import { EventInfo } from "@/components/event-parts/EventInfo"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { rpc } from "@/rpc"

import { useCalendars } from "@/contexts/CalendarStateContext"
import { useEventDraft } from "@/contexts/EventDraftContext"

import {
  addMinutes,
  DEFAULT_DURATION_MINS,
  type EventTime,
  isAllDay,
  normalizeAllDayRange,
  toAllDay,
  toTimedAtStartOfDay,
} from "@/lib/event-time"
import { rruleToRecurrence } from "@/lib/rrule-utils"

export const ComposeEventInner = ({
  summaryRef,
  onCreated,
  onBeforeCreate,
  onTabOut,
  onCancel,
}: {
  summaryRef?: Ref<HTMLTextAreaElement>
  onCreated: () => void
  onBeforeCreate?: (start: EventTime) => void
  onTabOut?: () => void
  /** Discard the in-progress event and close the composer. */
  onCancel?: () => void
}) => {
  const { calendars } = useCalendars()
  const {
    draftEvent,
    setDraftEvent,
    draftReminders,
    setDraftReminders,
    createDraftEvent,
    createDraftEventWithMeet,
  } = useEventDraft()
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [meetAvailable, setMeetAvailable] = useState(false)

  const { summary, description, start, end, location, calendarId, recurrence } = draftEvent
  const allDay = isAllDay(start)

  const recurrenceRRule = recurrence ? rrulestr(recurrence.rrule) : null

  const calendar = calendars.find((cal) => cal.slug === calendarId)
  const canCreateMeet = calendar?.provider === "google" && meetAvailable

  useEffect(() => {
    rpc.caldir
      .google_meet_status()
      // Connected AND the Meet feature isn't disabled in Settings → Google Features.
      .then((s) => setMeetAvailable(s.connected && s.meet_enabled))
      .catch(() => setMeetAvailable(false))
  }, [])

  const onCreate = useCallback(async () => {
    // Google Meet auto-create: build the event on Google (which mints the Meet
    // link) via REST, then sync to pull it into caldir — don't also create it
    // through caldir (would duplicate).
    if (draftEvent.createGoogleMeet && canCreateMeet && draftEvent.calendarId) {
      // Optimistic: shows the event instantly; the Meet link is minted on Google
      // and reconciled by a background sync.
      onBeforeCreate?.(draftEvent.start)
      createDraftEventWithMeet()
      onCreated()
      return
    }

    onBeforeCreate?.(draftEvent.start)
    await createDraftEvent()
    onCreated()
  }, [
    draftEvent,
    canCreateMeet,
    createDraftEvent,
    createDraftEventWithMeet,
    onCreated,
    onBeforeCreate,
  ])

  // Anything worth confirming before discarding?
  const hasContent = !!(
    draftEvent.summary?.trim() ||
    draftEvent.description?.trim() ||
    draftEvent.location?.trim() ||
    draftEvent.attendees.length ||
    draftEvent.conferenceUrl
  )

  const requestCancel = () => {
    if (!onCancel) return
    if (hasContent) setConfirmCancelOpen(true)
    else onCancel()
  }

  return (
    <>
      <div className="p-2">
        <EventInfo
          summaryRef={summaryRef}
          summary={summary}
          onClose={onCreate}
          description={description}
          start={start}
          end={end}
          allDay={allDay}
          location={location}
          conferenceUrl={draftEvent.conferenceUrl}
          onConferenceUrlChange={(url) => {
            setDraftEvent({ ...draftEvent, conferenceUrl: url.trim() || null })
          }}
          createGoogleMeet={draftEvent.createGoogleMeet}
          onCreateGoogleMeetChange={(create) =>
            setDraftEvent({ ...draftEvent, createGoogleMeet: create })
          }
          canCreateMeet={canCreateMeet}
          calendar={calendar}
          onDescriptionChange={(newDescription) => {
            setDraftEvent({ ...draftEvent, description: newDescription || null })
          }}
          onLocationChange={(newLocation) => {
            setDraftEvent({ ...draftEvent, location: newLocation || null })
          }}
          onChangeSummary={(newSummary) => {
            setDraftEvent({ ...draftEvent, summary: newSummary })
          }}
          onAllDayChange={(checked) => {
            if (checked) {
              const allDayStart = toAllDay(start)
              const { end: allDayEnd } = normalizeAllDayRange(allDayStart, toAllDay(end))
              setDraftEvent({ ...draftEvent, start: allDayStart, end: allDayEnd })
            } else {
              const timedStart = isAllDay(start) ? toTimedAtStartOfDay(start) : start
              setDraftEvent({
                ...draftEvent,
                start: timedStart,
                end: addMinutes(timedStart, DEFAULT_DURATION_MINS),
              })
            }
          }}
          onChangeDateTime={({ start: newStart, end: newEnd }) => {
            setDraftEvent({ ...draftEvent, start: newStart, end: newEnd })
          }}
          onCalendarChange={(newCalendarId) => {
            setDraftEvent({ ...draftEvent, calendarId: newCalendarId })
          }}
          recurrence={recurrenceRRule}
          attendees={draftEvent.attendees}
          onAttendeesChange={(newAttendees) => {
            setDraftEvent({ ...draftEvent, attendees: newAttendees })
          }}
          onRecurrenceChange={(rrule) => {
            setDraftEvent({ ...draftEvent, recurrence: rruleToRecurrence(rrule) })
          }}
          reminders={draftReminders}
          onReminderAdd={(mins) => setDraftReminders([...draftReminders, mins])}
          onReminderRemove={(mins) => setDraftReminders(draftReminders.filter((m) => m !== mins))}
        />
      </div>

      <div className="p-4 pt-0 flex flex-col gap-2">
        <Button
          onClick={onCreate}
          onKeyDown={(e) => {
            if (e.key !== "Tab" || e.shiftKey || !onTabOut) return
            e.preventDefault()
            onTabOut()
          }}
          className="w-full"
        >
          Add Event
        </Button>
        {onCancel && (
          <Button variant="secondary" className="w-full" onClick={requestCancel}>
            Cancel
          </Button>
        )}
      </div>

      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard event?</DialogTitle>
            <DialogDescription>
              This event hasn't been created yet. Your changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" autoFocus onClick={() => setConfirmCancelOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmCancelOpen(false)
                onCancel?.()
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
