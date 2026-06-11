import { listen } from "@tauri-apps/api/event"
import { useEffect, useRef } from "react"

import { useCalEvents } from "@/contexts/CalEventsContext"
import { useCalendarNavigation } from "@/contexts/CalendarStateContext"

import { eventKey } from "@/lib/cal-events"

// Listens for the "open-event" event emitted by the Rust side when a reminder
// notification is clicked. Payload: "<startEpochMs>::<eventInstanceId>". We
// navigate to the event's day (reliable) and best-effort select the event so
// its details open.
export function useOpenEventDeepLink() {
  const { navigateToDate } = useCalendarNavigation()
  const { calendarEvents, setActiveEventKey } = useCalEvents()

  // Keep a live ref so the async handler reads fresh events after navigation.
  const eventsRef = useRef(calendarEvents)
  eventsRef.current = calendarEvents

  useEffect(() => {
    const unlisten = listen<string>("open-event", async (event) => {
      const [msStr, id] = event.payload.split("::")
      const ms = Number(msStr)
      if (Number.isFinite(ms)) {
        await navigateToDate(new Date(ms))
      }
      if (!id) return
      // Events for the target range load asynchronously after navigation —
      // poll briefly for the matching event, then open it.
      for (let i = 0; i < 12; i++) {
        const match = eventsRef.current.find((e) => e.id === id)
        if (match) {
          setActiveEventKey(eventKey(match))
          return
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [navigateToDate, setActiveEventKey])
}
