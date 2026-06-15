import {
  ReactNode,
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { rpc } from "@/rpc"
import type { EventAttendee } from "@/rpc/bindings"

import {
  type CalendarEvent,
  type Recurrence,
  recurrenceToRpc,
  rpcToCalendarEvent,
} from "@/lib/cal-events"
import {
  addMinutes,
  computeEventDateInfo,
  DEFAULT_DURATION_MINS,
  formatDateKey,
  isAllDay,
  nowZoned,
  toInteropDate,
  type EventTime,
} from "@/lib/event-time"
import { toRpcEventTime } from "@/lib/event-time/rpc"
import { logger } from "@/lib/logger"
import { parseEventText } from "@/lib/magic-parser"

import { useCalEvents } from "./CalEventsContext"
import { useCalendars } from "./CalendarStateContext"
import { useSettings } from "./SettingsContext"
import { useSync } from "./SyncContext"

interface DraftEvent {
  summary: string
  description: string | null
  start: EventTime
  end: EventTime
  calendarId: string | null
  location: string | null
  recurrence: Recurrence | null
  attendees: EventAttendee[]
  conferenceUrl?: string | null
  /** Auto-create a Google Meet link on save (via the Calendar REST API). */
  createGoogleMeet?: boolean
}

interface EventTextContextType {
  text: string
  setText: (text: string) => void
}

interface EventDraftContextType {
  isDrafting: boolean
  setIsDrafting: (isDrafting: boolean) => void

  draftPopoverOpen: boolean
  setDraftPopoverOpen: (open: boolean) => void
  /** True while the "Add or discard?" confirmation is showing. */
  confirmDiscardOpen: boolean
  /** Close the draft, prompting first if it has content. */
  requestCloseDraft: () => void
  /** Discard the draft (used by the confirmation dialog). */
  discardDraft: () => void
  /** Create the draft event then close (used by the confirmation dialog). */
  confirmAddDraft: () => void

  defaultCalendarId: string | null

  draftEvent: DraftEvent
  setDraftEvent: (event: DraftEvent) => void

  draftReminders: number[]
  setDraftReminders: (reminders: number[]) => void

  setDefaultDraftEvent: () => void
  createDraftEvent: () => Promise<void>
  /** Like {@link createDraftEvent} but mints a Google Meet link via the Calendar
   * REST API. Shows the event optimistically and reconciles via sync. */
  createDraftEventWithMeet: () => void
}

const EventTextContext = createContext({} as EventTextContextType)
const EventDraftContext = createContext({} as EventDraftContextType)

export function useEventText() {
  return useContext(EventTextContext)
}

export function useEventDraft() {
  return useContext(EventDraftContext)
}

/** ZonedDateTime in viewer's local zone, rounded up to the next whole hour. */
function getClosestNextHour(): EventTime {
  const now = nowZoned()
  // Add 1 hour, then round down to the start of that hour.
  const advanced = addMinutes(now, 60)
  if (advanced.kind !== "datetime_zoned") return advanced
  const z = advanced.value.with({
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  })
  return { kind: "datetime_zoned", value: z }
}

export function EventDraftProvider({ children }: { children: ReactNode }) {
  const { calendars } = useCalendars()
  const { defaultCalendar, defaultReminders } = useSettings()
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftPopoverOpen, _setDraftPopoverOpen] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  const defaultCalendarId =
    (defaultCalendar && calendars.some((c) => c.slug === defaultCalendar)
      ? defaultCalendar
      : calendars[0]?.slug) ?? null

  const [text, _setText] = useState("")
  const [draftReminders, setDraftReminders] = useState<number[]>([])
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasParsedTimeRef = useRef(false)

  const generateDefaultDraftEvent = useCallback((): DraftEvent => {
    const start = getClosestNextHour()
    return {
      summary: "",
      description: null,
      start,
      end: addMinutes(start, DEFAULT_DURATION_MINS),
      calendarId: defaultCalendarId,
      location: null,
      recurrence: null,
      attendees: [],
      conferenceUrl: null,
    }
  }, [defaultCalendarId])

  const [draftEvent, setDraftEvent] = useState<DraftEvent>(generateDefaultDraftEvent())

  const setText = useCallback((newText: string) => {
    _setText(newText)

    if (!hasParsedTimeRef.current) {
      startTransition(() => {
        setDraftEvent((prev) => ({ ...prev, summary: newText }))
      })
    }

    if (parseTimerRef.current) clearTimeout(parseTimerRef.current)

    parseTimerRef.current = setTimeout(() => {
      const parsed = parseEventText(newText)

      hasParsedTimeRef.current =
        parsed.start !== null || parsed.recurrence !== null || parsed.location !== null

      startTransition(() => {
        setDraftEvent((prev) => {
          const updates: Partial<DraftEvent> = {
            summary: parsed.summary,
            recurrence: parsed.recurrence,
            location: parsed.location,
          }
          if (parsed.start) {
            updates.start = parsed.start
            updates.end = parsed.end ?? addMinutes(parsed.start, DEFAULT_DURATION_MINS)
          }
          return { ...prev, ...updates }
        })
      })
    }, 300)
  }, [])

  const setDefaultDraftEvent = useCallback(() => {
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current)
    hasParsedTimeRef.current = false
    setDraftEvent(generateDefaultDraftEvent())
    setDraftReminders(defaultReminders)
  }, [generateDefaultDraftEvent, defaultReminders])

  const setDraftPopoverOpen = useCallback(
    (open: boolean) => {
      _setDraftPopoverOpen(open)
      if (open) setDraftReminders(defaultReminders)
      else setDefaultDraftEvent()
    },
    [setDefaultDraftEvent, defaultReminders],
  )

  const { setCalendarEvents, reloadEvents, addOptimisticEvent, resolveOptimisticEvent } =
    useCalEvents()
  const { syncCalendars } = useSync()

  const createDraftEvent = useCallback(async () => {
    if (!draftEvent.calendarId) return

    const optimisticId = crypto.randomUUID()

    const optimisticEvent: CalendarEvent = {
      id: optimisticId,
      recurring_event_id: null,
      summary: draftEvent.summary ?? "",
      description: draftEvent.description,
      location: draftEvent.location ?? null,
      start: draftEvent.start,
      end: draftEvent.end,
      dateInfo: computeEventDateInfo(draftEvent.start, draftEvent.end),
      status: "confirmed",
      recurrence: draftEvent.recurrence,
      master_recurrence: null,
      reminders: draftReminders,
      organizer: null,
      attendees: draftEvent.attendees,
      conference_url: draftEvent.conferenceUrl ?? null,
      calendar_slug: draftEvent.calendarId,
      color: null,
      updated: null,
    }
    setCalendarEvents((prev) => [...prev, optimisticEvent])

    logger.info("Create event:", draftEvent)
    setDefaultDraftEvent()
    _setText("")

    const created = await rpc.caldir.create_event({
      calendar_slug: draftEvent.calendarId,
      summary: draftEvent.summary ?? "",
      description: draftEvent.description,
      location: draftEvent.location ?? null,
      start: toRpcEventTime(draftEvent.start),
      end: toRpcEventTime(draftEvent.end),
      recurrence: draftEvent.recurrence ? recurrenceToRpc(draftEvent.recurrence) : null,
      reminders: draftReminders,
      attendees: draftEvent.attendees,
      conference_url: draftEvent.conferenceUrl,
    })

    if (draftEvent.recurrence) {
      // create_event returns only the master VEVENT; refetch so the range is
      // expanded into individual instances on the calendar grid.
      await reloadEvents()
    } else {
      setCalendarEvents((prev) =>
        prev.map((e) => (e.id === optimisticId ? rpcToCalendarEvent(created) : e)),
      )
    }
    void syncCalendars([draftEvent.calendarId])
  }, [
    draftEvent,
    draftReminders,
    syncCalendars,
    setDefaultDraftEvent,
    setCalendarEvents,
    reloadEvents,
  ])

  const createDraftEventWithMeet = useCallback(() => {
    if (!draftEvent.calendarId) return

    const calendarId = draftEvent.calendarId
    const snapshot = draftEvent
    const reminders = draftReminders
    const optimisticId = crypto.randomUUID()

    const optimisticEvent: CalendarEvent = {
      id: optimisticId,
      recurring_event_id: null,
      summary: snapshot.summary ?? "",
      description: snapshot.description,
      location: snapshot.location ?? null,
      start: snapshot.start,
      end: snapshot.end,
      dateInfo: computeEventDateInfo(snapshot.start, snapshot.end),
      status: "confirmed",
      recurrence: snapshot.recurrence,
      master_recurrence: null,
      reminders,
      organizer: null,
      attendees: snapshot.attendees,
      conference_url: null,
      calendar_slug: calendarId,
      color: null,
      updated: null,
    }
    // Show it immediately and keep it across reloads; the real synced event
    // (with the Meet link) replaces it automatically once it arrives.
    addOptimisticEvent(optimisticEvent)
    setDefaultDraftEvent()
    _setText("")

    void (async () => {
      try {
        await rpc.caldir.create_event_with_meet({
          calendar_slug: calendarId,
          summary: snapshot.summary ?? "",
          description: snapshot.description,
          location: snapshot.location ?? null,
          all_day: isAllDay(snapshot.start),
          start_iso: toInteropDate(snapshot.start).toISOString(),
          end_iso: toInteropDate(snapshot.end).toISOString(),
          start_date: formatDateKey(snapshot.start),
          end_date: formatDateKey(snapshot.end),
          attendees: (snapshot.attendees ?? []).map((a) => a.email),
        })
        // Pull the new event in (honoring the auto-sync setting). On a successful
        // apply, caldir emits CALDIR_CHANGED → reload → the optimistic copy is
        // replaced by the synced event. With auto-sync off it stays visible until
        // the user next syncs.
        void syncCalendars([snapshot.calendarId ?? ""])
      } catch (e) {
        toast.error("Couldn't create the Google Meet event", {
          description: e instanceof Error ? e.message : String(e),
        })
        resolveOptimisticEvent(optimisticId)
      }
    })()
  }, [
    draftEvent,
    draftReminders,
    syncCalendars,
    setDefaultDraftEvent,
    addOptimisticEvent,
    resolveOptimisticEvent,
  ])

  // Closing a draft that has content asks first (Add / Discard) instead of
  // silently dropping it. Routed through the context so both the popover and
  // the calendar-grid click-away use the same prompt.
  const draftHasContent = useCallback(
    () =>
      !!(
        draftEvent.summary?.trim() ||
        draftEvent.location?.trim() ||
        draftEvent.description?.trim() ||
        draftEvent.attendees.length
      ),
    [draftEvent],
  )
  const requestCloseDraft = useCallback(() => {
    if (draftHasContent()) {
      // Hide the compose popover but KEEP the draft data, then show the
      // Add/Discard prompt as a standalone dialog. We close the popover with the
      // raw setter (not the wrapper) so the draft isn't reset — the dialog still
      // needs the summary, and "Add" still needs the full draft to create it.
      _setDraftPopoverOpen(false)
      setConfirmDiscardOpen(true)
    } else {
      setDraftPopoverOpen(false)
    }
  }, [draftHasContent, setDraftPopoverOpen])
  const discardDraft = useCallback(() => {
    setConfirmDiscardOpen(false)
    _setDraftPopoverOpen(false)
    setDefaultDraftEvent()
  }, [setDefaultDraftEvent])
  const confirmAddDraft = useCallback(() => {
    setConfirmDiscardOpen(false)
    // createDraftEvent resets the draft and closes via setDefaultDraftEvent.
    void createDraftEvent()
  }, [createDraftEvent])

  const textValue = useMemo<EventTextContextType>(() => ({ text, setText }), [text, setText])

  const draftValue = useMemo<EventDraftContextType>(
    () => ({
      isDrafting,
      setIsDrafting,
      draftPopoverOpen,
      setDraftPopoverOpen,
      confirmDiscardOpen,
      requestCloseDraft,
      discardDraft,
      confirmAddDraft,
      defaultCalendarId,
      draftEvent,
      setDraftEvent,
      draftReminders,
      setDraftReminders,
      setDefaultDraftEvent,
      createDraftEvent,
      createDraftEventWithMeet,
    }),
    [
      isDrafting,
      draftPopoverOpen,
      confirmDiscardOpen,
      requestCloseDraft,
      discardDraft,
      confirmAddDraft,
      defaultCalendarId,
      draftEvent,
      draftReminders,
      setDefaultDraftEvent,
      setDraftPopoverOpen,
      createDraftEvent,
      createDraftEventWithMeet,
    ],
  )

  return (
    <EventTextContext.Provider value={textValue}>
      <EventDraftContext.Provider value={draftValue}>{children}</EventDraftContext.Provider>
    </EventTextContext.Provider>
  )
}
