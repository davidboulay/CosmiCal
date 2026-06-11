import { useState } from "react"

import type { Calendar } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"

import { getCalendarColor } from "@/lib/calendar-styles"
import { cn } from "@/lib/utils"

import { CheckIcon } from "@/icons/check"
import { ChevronDownIcon } from "@/icons/chevron-down"
import { EyeIcon } from "@/icons/eye"
import { EyeClosedIcon } from "@/icons/eye-closed"

const COLLAPSED_KEY = "collapsedCalendarGroups"

export function CalendarList() {
  const {
    calendars,
    isLoadingCalendars,
    hiddenCalendarSlugs,
    toggleCalendarVisibility,
    isolatedSlug,
    toggleIsolate,
    accountNameOverrides,
  } = useCalendars()

  // Which account groups are collapsed (persisted across sessions).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"))
    } catch {
      return new Set()
    }
  })
  const toggleCollapsed = (account: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {}
      return next
    })
  }

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
      {[...groups.entries()].map(([account, cals]) => {
        // Visible calendars on top in their normal order, hidden ones below.
        const sorted = [...cals].sort((a, b) => {
          const aHidden = hiddenCalendarSlugs.has(a.slug) ? 1 : 0
          const bHidden = hiddenCalendarSlugs.has(b.slug) ? 1 : 0
          return aHidden - bHidden
        })
        const isCollapsed = !!account && collapsed.has(account)
        return (
          <div key={account || "__local"} className="flex flex-col gap-0.5">
            {account && (
              <button
                type="button"
                onClick={() => toggleCollapsed(account)}
                aria-expanded={!isCollapsed}
                className="flex items-center gap-1 px-1 pb-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 shrink-0 transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <span className="truncate">{accountNameOverrides[account] ?? account}</span>
              </button>
            )}
            {!isCollapsed &&
              sorted.map((calendar) => {
                const isHidden = hiddenCalendarSlugs.has(calendar.slug)
                const isIsolated = isolatedSlug === calendar.slug
                const color = getCalendarColor(calendar)
                return (
                  <div
                    key={calendar.slug}
                    className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-hover transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCalendarVisibility(calendar.slug)}
                      className="flex min-w-0 grow items-center gap-2.5 text-left"
                    >
                      <span
                        className={cn(
                          "size-4 shrink-0 grid place-content-center rounded-xs border transition-colors",
                          isHidden ? "border-input" : "border-transparent",
                        )}
                        style={
                          isHidden ? undefined : { backgroundColor: color, borderColor: color }
                        }
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
                    <button
                      type="button"
                      onClick={() => toggleIsolate(calendar.slug)}
                      title={isIsolated ? "Show all calendars" : "Show only this calendar"}
                      aria-label={isIsolated ? "Show all calendars" : "Show only this calendar"}
                      aria-pressed={isIsolated}
                      className={cn(
                        "shrink-0 grid place-content-center rounded-xs p-0.5 transition-colors",
                        isIsolated
                          ? "text-foreground"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
                      )}
                    >
                      {isIsolated ? (
                        <EyeIcon className="size-4" />
                      ) : (
                        <EyeClosedIcon className="size-4" />
                      )}
                    </button>
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
