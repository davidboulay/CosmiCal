import { type ReactNode, useState } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { SyncPreview } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"
import { useSettings } from "@/contexts/SettingsContext"
import { type CalendarSyncStatus, useSync } from "@/contexts/SyncContext"

import { useIsOnline } from "@/hooks/useIsOnline"
import { cn } from "@/lib/utils"

import { CloudOffIcon } from "@/icons/cloud-off"
import { CloudWarningIcon } from "@/icons/cloud-warning"
import { SyncIcon as RefreshIcon } from "@/icons/sync"

import { Button } from "../ui/button"

export const SyncStatus = () => {
  const { isChecking, isSyncing, syncError, pendingPreviews, calendarStatuses, syncNow } = useSync()
  const [isForcingSync, setIsForcingSync] = useState(false)
  // Controlled so the status bubble also pops open on click (not just hover).
  const [open, setOpen] = useState(false)

  const isOnline = useIsOnline()

  const pendingCount = pendingPreviews.reduce(
    (acc, p) => acc + p.to_push_count + p.to_pull_count,
    0,
  )

  // "Active" = currently working (spinning); "stale" = changes waiting to sync.
  const active = isChecking || isSyncing || isForcingSync
  const stale = !active && pendingCount > 0

  let icon = (
    <RefreshIcon
      className={cn(
        "size-[18px] pointer-events-none",
        active && "animate-spin text-foreground",
        stale && "text-today",
        !active && !stale && "text-muted-foreground",
      )}
    />
  )

  let tooltipContent: ReactNode = <>Up to date · Click to refresh</>

  const hasLiveStatuses = Object.keys(calendarStatuses).length > 0

  if (isChecking && !isSyncing && !isForcingSync) {
    tooltipContent = hasLiveStatuses ? (
      <ReloadStatusList header="Checking for changes…" calendarStatuses={calendarStatuses} />
    ) : (
      <>Checking for changes…</>
    )
  }

  if (isSyncing || isForcingSync) {
    const header = pendingCount
      ? `Syncing ${pendingCount} change${pendingCount === 1 ? "" : "s"}…`
      : "Refreshing…"
    tooltipContent = hasLiveStatuses ? (
      <ReloadStatusList header={header} calendarStatuses={calendarStatuses} />
    ) : (
      <>{header}</>
    )
  }

  if (stale) {
    tooltipContent = <AccountChangesList header="Click to sync" pendingPreviews={pendingPreviews} />
  }

  if (syncError) {
    icon = <CloudWarningIcon className="size-4 text-warning pointer-events-none" />
    tooltipContent = (
      <div className="flex flex-col gap-0.5">
        <span>{syncError}</span>
        <span className="text-xs text-muted-foreground">Click to retry</span>
      </div>
    )
  }

  if (!isOnline) {
    icon = <CloudOffIcon className="size-4 text-error pointer-events-none" />
    tooltipContent = <>No internet connection</>
  }

  const handleSyncNow = async () => {
    setOpen(true) // show what's happening
    setIsForcingSync(true)
    try {
      await syncNow()
    } finally {
      setIsForcingSync(false)
      // Leave the result visible briefly, then let hover take over.
      setTimeout(() => setOpen(false), 1500)
    }
  }

  const button = (
    <Button
      variant="ghost"
      size="icon"
      tabIndex={-1}
      className="relative focus-visible:ring-0 cursor-pointer"
      disabled={isSyncing || isForcingSync}
      onClick={() => void handleSyncNow()}
    >
      <div style={{ animation: "scale-in 0.15s ease-out" }}>{icon}</div>

      {!!pendingCount && <DiffCounterBadge count={pendingCount} />}
    </Button>
  )

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild tabIndex={-1}>
        {button}
      </TooltipTrigger>
      <TooltipContent className="max-w-72 wrap-break-word">{tooltipContent}</TooltipContent>
    </Tooltip>
  )
}

const DiffCounterBadge = ({ count }: { count: number }) => {
  const { autoSyncEnabled } = useSettings()

  if (autoSyncEnabled) return null

  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-[14px] text-center">
      {count}
    </span>
  )
}

// Human label for one calendar's live reload phase.
const phaseLabel = (s: CalendarSyncStatus): string => {
  switch (s.phase) {
    case "pending":
      return "Waiting…"
    case "checking":
      return "Checking…"
    case "checked": {
      const parts: string[] = []
      if (s.toPull) parts.push(`${s.toPull} to pull`)
      if (s.toPush) parts.push(`${s.toPush} to push`)
      return parts.length ? parts.join(", ") : "Up to date"
    }
    case "pulling":
      return s.toPull ? `Pulling ${s.toPull}…` : "Pulling…"
    case "pushing":
      return s.toPush ? `Pushing ${s.toPush}…` : "Pushing…"
    case "done": {
      const parts: string[] = []
      if (s.toPull) parts.push(`${s.toPull} pulled`)
      if (s.toPush) parts.push(`${s.toPush} pushed`)
      return parts.length ? parts.join(", ") : "Up to date"
    }
    case "error":
      return s.error ? `Error: ${s.error}` : "Error"
  }
}

// Live, per-account breakdown of what the reload is doing right now, driven by
// backend `sync-progress` events. Calendars are grouped under their account.
const ReloadStatusList = ({
  header,
  calendarStatuses,
}: {
  header: string
  calendarStatuses: Record<string, CalendarSyncStatus>
}) => {
  const { calendars } = useCalendars()

  const byAccount = new Map<string, { name: string; status: CalendarSyncStatus }[]>()
  for (const [slug, status] of Object.entries(calendarStatuses)) {
    const cal = calendars.find((c) => c.slug === slug)
    const account = cal?.account ?? "Other"
    const list = byAccount.get(account) ?? []
    list.push({ name: cal?.name ?? slug, status })
    byAccount.set(account, list)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-medium">{header}</div>

      {[...byAccount.entries()].map(([account, cals]) => (
        <div key={account} className="flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 truncate">
            {account}
          </div>
          {cals.map(({ name, status }) => (
            <div key={name} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground">{name}</span>
              <span
                className={cn("shrink-0 numerical", status.phase === "error" && "text-warning")}
              >
                {phaseLabel(status)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Per-calendar breakdown of what the current reload is doing, under a header.
const AccountChangesList = ({
  header,
  pendingPreviews,
}: {
  header: string
  pendingPreviews: SyncPreview[]
}) => {
  const { calendars } = useCalendars()
  const calendarName = (slug: string) => calendars.find((c) => c.slug === slug)?.name ?? slug

  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium">{header}</div>

      {pendingPreviews.map((p) => {
        const parts: string[] = []
        if (p.to_pull_count > 0) parts.push(`${p.to_pull_count} to pull`)
        if (p.to_push_count > 0) parts.push(`${p.to_push_count} to push`)

        return (
          <div key={p.calendar_slug} className="text-xs text-muted-foreground">
            {calendarName(p.calendar_slug)}: {parts.join(", ") || "no changes"}
          </div>
        )
      })}
    </div>
  )
}
