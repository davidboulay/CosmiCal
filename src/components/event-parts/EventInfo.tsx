import { RRule, RRuleSet } from "rrule"

import { AllDayCheckbox } from "@/components/event-parts/inputs/AllDayCheckbox"
import { AttendeesDisplay } from "@/components/event-parts/inputs/AttendeesDisplay"
import { CalendarSelect } from "@/components/event-parts/inputs/CalendarSelect"
import { ConferenceInput } from "@/components/event-parts/inputs/ConferenceInput"
import { ConferenceLink } from "@/components/event-parts/inputs/ConferenceLink"
import { DateTimeSelect, type DateTimeRange } from "@/components/event-parts/inputs/DateTimeSelect"
import { LocationInput } from "@/components/event-parts/inputs/LocationInput"
import { ReminderSelect } from "@/components/event-parts/inputs/ReminderSelect"
import { RepeatSelect } from "@/components/event-parts/inputs/RepeatSelect"
import { Textarea } from "@/components/ui/textarea"

import type { Calendar, EventAttendee, ResponseStatus } from "@/rpc/bindings"

import { useSettings } from "@/contexts/SettingsContext"

import { formatTimeInZone, getZoneDisplayName, type EventTime } from "@/lib/event-time"
import { cn } from "@/lib/utils"

import { NotesInput } from "./inputs/NotesInput"
import { RsvpBar } from "./inputs/RsvpBar"

const Divider = () => (
  <div className="my-2 opacity-75">
    <hr />
  </div>
)

/** Read-only lines showing the event's time in each configured extra timezone. */
function ExtraTimezoneTimes({ start, end }: { start: EventTime; end: EventTime }) {
  const { timeFormat, extraTimezones, timezoneLabels } = useSettings()
  if (extraTimezones.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5 pl-2 text-xs text-muted-foreground">
      {extraTimezones.map((tz) => (
        <div key={tz} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate" title={tz}>
            {getZoneDisplayName(tz, timezoneLabels)}
          </span>
          <span className="numerical">
            {formatTimeInZone(start, timeFormat, tz)} – {formatTimeInZone(end, timeFormat, tz)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function EventInfo({
  readonly,
  summaryRef,
  summary,
  onChangeSummary,
  start,
  end,
  onChangeDateTime,
  allDay,
  onAllDayChange,
  showTime,
  location,
  onLocationChange,
  calendar,
  onCalendarChange,
  recurrence,
  onRecurrenceChange,
  description,
  onDescriptionChange,
  organizer,
  attendees,
  onAttendeesChange,
  conferenceUrl,
  onConferenceUrlChange,
  createGoogleMeet,
  onCreateGoogleMeetChange,
  canCreateMeet,
  reminders,
  onReminderAdd,
  onReminderRemove,
  onRsvp,
  userResponseStatus,
  isPendingInvite,
  onClose,
}: {
  readonly?: boolean
  summaryRef?: React.Ref<HTMLTextAreaElement>
  summary?: string | null
  onChangeSummary: (summary: string) => void
  onClose?: () => void
  start: EventTime
  end: EventTime
  onChangeDateTime: (range: DateTimeRange) => void
  allDay: boolean
  onAllDayChange: (checked: boolean) => void
  location?: string | null
  onLocationChange: (location: string) => void
  recurrence: RRule | RRuleSet | null
  onRecurrenceChange: (recurrence: RRule | RRuleSet | null) => void
  calendar?: Calendar
  onCalendarChange: (calendarId: string) => void
  showTime?: boolean
  description?: string | null
  onDescriptionChange: (description: string) => void
  organizer?: EventAttendee | null
  attendees?: EventAttendee[]
  onAttendeesChange?: (attendees: EventAttendee[]) => void
  conferenceUrl?: string | null
  onConferenceUrlChange?: (url: string) => void
  createGoogleMeet?: boolean
  onCreateGoogleMeetChange?: (create: boolean) => void
  /** True when the selected calendar can auto-create a Meet (Google + connected). */
  canCreateMeet?: boolean
  reminders?: number[]
  onReminderAdd: (mins: number) => void
  onReminderRemove: (mins: number) => void
  onRsvp?: (response: ResponseStatus) => void
  userResponseStatus?: ResponseStatus | null
  isPendingInvite?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 grow">
      <div className="flex min-h-control-height items-center">
        <Textarea
          ref={summaryRef}
          placeholder="Event Title"
          value={summary ?? ""}
          className={cn(
            "text-base font-medium",
            readonly && "hover:border-transparent! focus:bg-transparent!",
          )}
          readOnly={readonly}
          onChange={(e) => onChangeSummary(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onClose?.()
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <LocationInput
          value={location}
          onChange={onLocationChange}
          onClose={onClose}
          readOnly={readonly}
        />

        <DateTimeSelect
          start={start}
          end={end}
          showTime={showTime}
          readOnly={readonly}
          onChange={onChangeDateTime}
        />
        <AllDayCheckbox checked={allDay} onCheckedChange={onAllDayChange} readOnly={readonly} />

        {!allDay && <ExtraTimezoneTimes start={start} end={end} />}

        <RepeatSelect value={recurrence} onChange={onRecurrenceChange} readOnly={readonly} />

        {readonly
          ? conferenceUrl && <ConferenceLink url={conferenceUrl} />
          : onConferenceUrlChange && (
              <ConferenceInput
                value={conferenceUrl}
                onChange={onConferenceUrlChange}
                onClose={onClose}
                readOnly={readonly}
                createGoogleMeet={createGoogleMeet}
                onCreateGoogleMeetChange={onCreateGoogleMeetChange}
                canCreateMeet={canCreateMeet}
              />
            )}

        {(!!attendees?.length || !readonly) && (
          <>
            {!!attendees?.length && <Divider />}

            <AttendeesDisplay
              organizer={organizer}
              attendees={attendees}
              readOnly={readonly}
              onAttendeesChange={onAttendeesChange}
            />

            {!!attendees?.length && <Divider />}
          </>
        )}

        {!calendar?.read_only && (
          <ReminderSelect
            reminders={reminders ?? []}
            onSelect={onReminderAdd}
            onRemove={onReminderRemove}
          />
        )}

        <CalendarSelect calendar={calendar} onChange={onCalendarChange} readOnly={readonly} />

        <NotesInput value={description} onChange={onDescriptionChange} readOnly={readonly} />

        {onRsvp && (
          <>
            <Divider />

            <div className="px-3 pt-1 text-xs font-medium text-muted-foreground">
              {isPendingInvite ? "Respond to invitation" : "My response"}
            </div>
            <RsvpBar status={userResponseStatus} onRsvp={onRsvp} />
          </>
        )}
      </div>
    </div>
  )
}
