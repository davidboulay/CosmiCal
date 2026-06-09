import { useEffect, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

import { getForecast, type DailyWeather } from "@/lib/weather"

// Daily forecast keyed by "YYYY-MM-DD". Empty when weather is disabled or the
// location can't be resolved. Refetches when the location override changes and
// hourly while mounted.
export function useWeather(): Map<string, DailyWeather> {
  const { weatherEnabled, weatherLocation } = useSettings()
  const [data, setData] = useState<Map<string, DailyWeather>>(() => new Map())

  useEffect(() => {
    if (!weatherEnabled) {
      setData(new Map())
      return
    }

    let cancelled = false
    const load = async () => {
      const days = await getForecast(weatherLocation)
      if (!cancelled) setData(new Map(days.map((d) => [d.dateKey, d])))
    }

    void load()
    const id = setInterval(() => void load(), 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [weatherEnabled, weatherLocation])

  return data
}
