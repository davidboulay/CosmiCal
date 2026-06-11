import { ReactNode, useRef, useState } from "react"

import { CalendarItem } from "@/components/event-parts/inputs/CalendarSelect"
import { AddAccountModal } from "@/components/settings/accounts/AddAccountModal"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { Calendar } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"
import { useSettings } from "@/contexts/SettingsContext"

import { getProviderDisplayName } from "@/lib/providers"

import { MoreHorizIcon } from "@/icons/more-horiz"
import { PlusIcon } from "@/icons/plus"
import { RssIcon } from "@/icons/rss"

export function CalendarsPage() {
  const { calendars } = useCalendars()
  const [showAdd, setShowAdd] = useState(false)

  const remoteCalendars = calendars.filter((c) => c.provider !== null)
  const localCalendars = calendars.filter((c) => c.provider === null)
  const calendarsByProvider = Object.groupBy(remoteCalendars, (c) => c.provider as string)

  return (
    <div className="flex flex-col gap-6">
      {!!calendars.length && (
        <div className="flex flex-col gap-4">
          {Object.entries(calendarsByProvider).map(([provider, cals]) => (
            <CalendarGroup
              key={provider}
              title={getProviderDisplayName(provider)}
              calendars={cals ?? []}
            />
          ))}

          {localCalendars.length > 0 && (
            <CalendarGroup title="Local-only" calendars={localCalendars} />
          )}
        </div>
      )}

      {!calendars.length && (
        <div className="text-sm text-muted-foreground">
          No calendars yet. Connect an account or create a local calendar to get started.
        </div>
      )}

      <Button className="self-start gap-2" onClick={() => setShowAdd(true)}>
        <PlusIcon className="size-4" />
        Add calendar
      </Button>

      {showAdd && <AddAccountModal showLocalOnlyOption onClose={() => setShowAdd(false)} />}

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="self-start hidden">
            <Button variant="secondary" className="gap-2" disabled>
              <RssIcon className="size-4" />
              Add subscription
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming soon</TooltipContent>
      </Tooltip>
    </div>
  )
}

function CalendarGroup({ title, calendars }: { title: string; calendars: Calendar[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{title}</span>
      <div className="flex flex-col gap-1">
        {calendars.map((calendar) => (
          <CalendarDropdownMenuWrapper key={calendar.slug} calendar={calendar}>
            <CalendarItem calendar={calendar} />
          </CalendarDropdownMenuWrapper>
        ))}
      </div>
    </div>
  )
}

function CalendarDropdownMenuWrapper({
  calendar,
  children,
}: {
  calendar: Calendar
  children: ReactNode
}) {
  const { defaultCalendar, setDefaultCalendar } = useSettings()
  const { calendarColorOverrides, setCalendarColor, resetCalendarColor } = useCalendars()
  const isDefault = defaultCalendar === calendar.slug
  const hasColorOverride = calendar.slug in calendarColorOverrides
  const colorInputRef = useRef<HTMLInputElement>(null)

  // <input type=color> needs a concrete hex; fall back to a neutral when the
  // color is a CSS var or unset.
  const swatchValue =
    calendar.color && /^#[0-9a-f]{6}$/i.test(calendar.color) ? calendar.color : "#3b82f6"

  return (
    <div className="flex items-center gap-3">
      <div className="grow min-w-0">{children}</div>

      {isDefault && <span className="text-xs text-muted-foreground">Default</span>}

      {/* Hidden native picker, opened from the menu. */}
      <input
        ref={colorInputRef}
        type="color"
        value={swatchValue}
        onChange={(e) => setCalendarColor(calendar.slug, e.target.value)}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={isDefault}
            onClick={() => void setDefaultCalendar(calendar.slug)}
          >
            Set as default
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              colorInputRef.current?.click()
            }}
          >
            Change color…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasColorOverride}
            onClick={() => resetCalendarColor(calendar.slug)}
          >
            Reset color
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
