import { useEffect, useRef } from "react"

import { MainHeader } from "@/components/main/MainHeader"
import { ThreeDayView } from "@/components/main/ThreeDayView"
import { MonthView } from "@/components/main/month-view/MonthView"
import { WeekView } from "@/components/main/week-view/WeekView"
import { openSettingsWindow } from "@/components/toolbar/SettingsButton"
import { Tabs, TabsContent } from "@/components/ui/tabs"

import { useCalendars } from "@/contexts/CalendarStateContext"

import { useOpenEventDeepLink } from "@/hooks/useOpenEventDeepLink"
import { CalendarView, calendarViewSchema } from "@/lib/calendar-view"

export function Main({
  calendarView,
  onChangeCalendarView,
}: {
  calendarView: CalendarView
  onChangeCalendarView: (view: CalendarView) => void
}) {
  useOpenEventDeepLink()

  // With no calendars yet, guide the user straight to setup: open Settings on
  // the Calendars tab (once per launch).
  const { calendars, isLoadingCalendars } = useCalendars()
  const promptedRef = useRef(false)
  useEffect(() => {
    if (isLoadingCalendars || promptedRef.current) return
    if (calendars.length === 0) {
      promptedRef.current = true
      void openSettingsWindow("calendars")
    }
  }, [calendars, isLoadingCalendars])

  return (
    <Tabs
      value={calendarView}
      onValueChange={(v) => onChangeCalendarView(calendarViewSchema.parse(v))}
      className="hidden sm:flex flex-col grow min-w-0"
    >
      <MainHeader calendarView={calendarView} />

      <div className="h-[calc(100vh-64px)] select-none">
        <TabsContent value="week" className="h-full">
          <WeekView />
        </TabsContent>
        <TabsContent value="3day" className="h-full">
          <ThreeDayView />
        </TabsContent>
        <TabsContent value="month" className="h-full">
          <MonthView />
        </TabsContent>
      </div>
    </Tabs>
  )
}
