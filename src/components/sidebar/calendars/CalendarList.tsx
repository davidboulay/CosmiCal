import type { Calendar } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"

import { getCalendarColor } from "@/lib/calendar-styles"
import { cn } from "@/lib/utils"

import { CheckIcon } from "@/icons/check"

export function CalendarList() {
  const { calendars, isLoadingCalendars, hiddenCalendarSlugs, toggleCalendarVisibility } =
    useCalendars()

  if (isLoadingCalendars) {
    return <div className="grow" />
  }

  if (calendars.length === 0) {
    return null
  }

  // Group by account so the list reads like Google Calendar's "My calendars" /
  // "Other calendars" sections. Calendars without an account (e.g. local) fall
  // into an untitled group rendered without a header.
  const groups = new Map<string, Calendar[]>()
  for (const calendar of calendars) {
    const key = calendar.account ?? ""
    const list = groups.get(key) ?? []
    list.push(calendar)
    groups.set(key, list)
  }

  return (
    <div className="grow overflow-auto select-none px-3 py-2 flex flex-col gap-4">
      {[...groups.entries()].map(([account, cals]) => (
        <div key={account || "__local"} className="flex flex-col gap-0.5">
          {account && (
            <div className="px-1 pb-1 text-xs text-muted-foreground truncate">{account}</div>
          )}
          {cals.map((calendar) => {
            const isHidden = hiddenCalendarSlugs.has(calendar.slug)
            const color = getCalendarColor(calendar)
            return (
              <button
                key={calendar.slug}
                type="button"
                onClick={() => toggleCalendarVisibility(calendar.slug)}
                className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-hover transition-colors"
              >
                <span
                  className={cn(
                    "size-4 shrink-0 grid place-content-center rounded-xs border transition-colors",
                    isHidden ? "border-input" : "border-transparent",
                  )}
                  style={isHidden ? undefined : { backgroundColor: color, borderColor: color }}
                >
                  {!isHidden && <CheckIcon className="size-3.5 text-white" />}
                </span>
                <span
                  className={cn(
                    "text-sm truncate transition-colors",
                    isHidden ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {calendar.name ?? calendar.slug}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
