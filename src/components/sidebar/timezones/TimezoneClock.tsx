import { useEffect, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

import { getLocalTzid, getZoneDisplayName } from "@/lib/event-time"

// A compact list of the configured time zones with their current local time,
// shown under the mini-calendar. Only rendered when the user has added extra
// zones (otherwise it's just a redundant local clock).
export function TimezoneClock() {
  const { extraTimezones, timeFormat, timezoneLabels } = useSettings()
  const [now, setNow] = useState(() => new Date())

  // Tick often enough to catch the minute rollover without busy-waiting.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (extraTimezones.length === 0) return null

  const zones = [getLocalTzid(), ...extraTimezones]

  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: timeFormat === "12h" ? "h12" : "h23",
      timeZone: tz,
    }).format(now)

  return (
    <div className="px-4 py-3 flex flex-col gap-1 border-b border-divider">
      {zones.map((tz) => (
        <div key={tz} className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate" title={tz}>
            {getZoneDisplayName(tz, timezoneLabels)}
          </span>
          <span className="text-sm numerical shrink-0">{format(tz)}</span>
        </div>
      ))}
    </div>
  )
}
