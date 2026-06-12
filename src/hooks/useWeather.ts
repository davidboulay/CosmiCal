import { useEffect, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

import { getForecast, type DailyWeather } from "@/lib/weather"

// Daily forecast keyed by "YYYY-MM-DD". Empty when weather is disabled or the
// location can't be resolved. Refetches when the location override changes and
// hourly while mounted.
export function useWeather(): Map<string, DailyWeather> {
  const { weatherEnabled, weatherLocation, weatherAutoLocation, weatherUnit } = useSettings()
  const [data, setData] = useState<Map<string, DailyWeather>>(() => new Map())

  // In auto mode the location is detected from IP (empty query); the manual
  // value is ignored but kept for when the user switches back.
  const effectiveLocation = weatherAutoLocation ? "" : weatherLocation

  useEffect(() => {
    if (!weatherEnabled) {
      setData(new Map())
      return
    }

    let cancelled = false
    const load = async () => {
      const days = await getForecast(effectiveLocation, weatherUnit)
      if (!cancelled) setData(new Map(days.map((d) => [d.dateKey, d])))
    }

    // Reload hourly: re-detects the location in auto mode, so the forecast
    // follows you when travelling.
    void load()
    const id = setInterval(() => void load(), 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [weatherEnabled, effectiveLocation, weatherUnit])

  return data
}
