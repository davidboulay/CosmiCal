import { format } from "date-fns"
import { useEffect, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

export function CurrentTimeIndicator() {
  const { timeFormat } = useSettings()
  const [now, setNow] = useState(() => new Date())

  // The colon blinks via CSS, so we only need to tick state once per minute to
  // reposition the indicator and update the displayed h:mm.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const timeIndicatorTopPercent = (currentMinutes / 1440) * 100

  const label = format(now, timeFormat === "12h" ? "h:mm a" : "HH:mm")

  return (
    <div
      className="absolute -left-12 -right-1 z-20 pointer-events-none flex items-center"
      style={{ top: `${timeIndicatorTopPercent}%`, transform: "translateY(-50%)" }}
    >
      {/* Time pill in the gutter */}
      <span className="w-10 shrink-0 text-right pr-1 text-[10px] font-semibold text-today leading-none tabular-nums">
        {label}
      </span>
      {/* Filled dot at the start of the line, then a solid line across the day */}
      <span className="size-2.5 shrink-0 rounded-full bg-today" />
      <div className="grow border-t border-today" />
    </div>
  )
}
