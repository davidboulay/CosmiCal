import { open } from "@tauri-apps/plugin-dialog"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { TimeFormat } from "@/rpc/bindings"

import { useSettings } from "@/contexts/SettingsContext"

export function GeneralPage() {
  return (
    <div className="flex flex-col gap-6">
      <TimeFormatSection />
      <AllDayVisibleSection />
      <DataDirectorySection />
      <AutoSyncSection />
      <StartAtLoginSection />
    </div>
  )
}

const StartAtLoginSection = () => {
  const { startAtLogin, setStartAtLogin, startMinimized, setStartMinimized } = useSettings()
  const id = useId()
  const minId = useId()

  return (
    <div className="flex flex-col gap-2 w-[400px]">
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={startAtLogin}
          onCheckedChange={(checked) => void setStartAtLogin(checked === true)}
          className="cursor-pointer"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm">
          Start at login
        </Label>
      </div>
      <p className="text-xs text-muted-foreground pl-7">
        Launch CosmiCal automatically when you log in, so reminders and the tray icon are ready in
        the background.
      </p>
      {startAtLogin && (
        <div className="flex items-center gap-3 pl-7">
          <Checkbox
            id={minId}
            checked={startMinimized}
            onCheckedChange={(checked) => void setStartMinimized(checked === true)}
            className="cursor-pointer"
          />
          <Label htmlFor={minId} className="cursor-pointer text-sm">
            Start minimized to the tray (no window on login)
          </Label>
        </div>
      )}
    </div>
  )
}

const AllDayVisibleSection = () => {
  const { allDayVisibleCount, setAllDayVisibleCount } = useSettings()

  return (
    <div className="flex flex-col gap-2 w-[300px]">
      <label className="text-sm">All-day rows before collapsing</label>
      <Select
        value={String(allDayVisibleCount)}
        onValueChange={(v) => void setAllDayVisibleCount(Number(v))}
      >
        <SelectTrigger className="w-full" ghost={false}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} {n === 1 ? "row" : "rows"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        How many stacked all-day events the week view shows before collapsing the rest behind a
        “more” toggle.
      </p>
    </div>
  )
}

const TimeFormatSection = () => {
  const { timeFormat, setTimeFormat } = useSettings()

  return (
    <div className="flex flex-col gap-2 w-[300px]">
      <label className="text-sm">Time format</label>
      <Select value={timeFormat} onValueChange={(v) => setTimeFormat(v as TimeFormat)}>
        <SelectTrigger className="w-full" ghost={false}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">24h</SelectItem>
          <SelectItem value="12h">12h</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// Offered cadences (minutes). Lower = fresher incoming changes, more
// network/battery — each check re-lists the full sync window since there's no
// server push. Kept within SettingsContext's 1–60 clamp.
const SYNC_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30, 60]

const AutoSyncSection = () => {
  const { autoSyncEnabled, setAutoSyncEnabled, syncIntervalMinutes, setSyncIntervalMinutes } =
    useSettings()
  const id = useId()

  return (
    <div className="flex flex-col gap-2 w-[400px]">
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={autoSyncEnabled}
          onCheckedChange={(checked) => void setAutoSyncEnabled(checked === true)}
          className="cursor-pointer"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm">
          Automatic sync
        </Label>
      </div>
      <p className="text-xs text-muted-foreground pl-7">
        When off, renCal only checks for changes and shows a counter — click the sync icon to apply
        them.
      </p>

      <div className="flex flex-col gap-2 pl-7 mt-2">
        <label className="text-sm">Check for changes every</label>
        <Select
          value={String(syncIntervalMinutes)}
          onValueChange={(v) => void setSyncIntervalMinutes(Number(v))}
        >
          <SelectTrigger className="w-[200px]" ghost={false}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNC_INTERVAL_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m === 60 ? "1 hour" : `${m} ${m === 1 ? "minute" : "minutes"}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          How often CosmiCal polls your accounts for changes made elsewhere. There's no instant push
          from the server, so this sets how fresh your calendars stay. Your own edits sync
          immediately regardless.
        </p>
      </div>
    </div>
  )
}

const DataDirectorySection = () => {
  const { calendarDir, setCalendarDir } = useSettings()

  const onChange = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected !== "string") return
    await setCalendarDir(selected)
  }

  return (
    <div className="flex flex-col gap-2 w-[400px]">
      <label className="text-sm">Data directory</label>
      <p className="text-xs text-muted-foreground">
        Calendars are stored in an app folder by default — you don't need to manage this. Change it
        only if you want them somewhere specific.
      </p>
      <div className="flex gap-2">
        <Input value={calendarDir} readOnly ghost={false} className="flex-1" />
        <Button variant="secondary" onClick={onChange}>
          Change
        </Button>
      </div>
    </div>
  )
}
