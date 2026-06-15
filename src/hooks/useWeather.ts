import { useEffect, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

import { getForecast, type DailyWeather, type Located } from "@/lib/weather"

export interface WeatherData {
  /** Daily forecast keyed by "YYYY-MM-DD". */
  forecast: Map<string, DailyWeather>
  /** Resolved location (with coordinates) for deep-linking to a weather site. */
  location: Located | null
}

// Daily forecast + resolved location. Empty when weather is disabled or the
// location can't be resolved. Refetches when the location override changes and
// hourly while mounted.
export function useWeather(): WeatherData {
  const { weatherEnabled, weatherLocation, weatherAutoLocation, weatherUnit } = useSettings()
  const [data, setData] = useState<WeatherData>(() => ({ forecast: new Map(), location: null }))

  // In auto mode the location is detected from IP (empty query); the manual
  // value is ignored but kept for when the user switches back.
  const effectiveLocation = weatherAutoLocation ? "" : weatherLocation

  useEffect(() => {
    if (!weatherEnabled) {
      setData({ forecast: new Map(), location: null })
      return
    }

    let cancelled = false
    const load = async () => {
      const { days, location } = await getForecast(effectiveLocation, weatherUnit)
      if (!cancelled) setData({ forecast: new Map(days.map((d) => [d.dateKey, d])), location })
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
