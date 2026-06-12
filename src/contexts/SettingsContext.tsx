import { emit, listen } from "@tauri-apps/api/event"
import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react"

import { rpc } from "@/rpc"
import type { TimeFormat } from "@/rpc/bindings"
import {
  AUTO_SYNC_ENABLED_CHANGED,
  CALENDAR_DIR_CHANGED,
  DEFAULT_CALENDAR_CHANGED,
  DEFAULT_REMINDERS_CHANGED,
  EXTRA_TIMEZONES_CHANGED,
  NOTIFICATIONS_ENABLED_CHANGED,
  START_AT_LOGIN_CHANGED,
  TIMEZONE_LABELS_CHANGED,
  TIME_FORMAT_CHANGED,
  WEATHER_SETTINGS_CHANGED,
} from "@/rpc/events"

// Up to two additional timezones shown alongside the local zone in the week
// view gutter and event details. Persisted in localStorage (no backend), kept
// in sync across windows via the EXTRA_TIMEZONES_CHANGED event.
const EXTRA_TIMEZONES_KEY = "extraTimezones"
export const MAX_EXTRA_TIMEZONES = 2

function loadExtraTimezones(): string[] {
  try {
    const raw = localStorage.getItem(EXTRA_TIMEZONES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((z): z is string => typeof z === "string").slice(0, MAX_EXTRA_TIMEZONES)
  } catch {
    return []
  }
}

// Optional user-chosen display names for time zones, keyed by IANA id. Falls
// back to the city name when a zone has no custom label.
const TIMEZONE_LABELS_KEY = "timezoneLabels"

function loadTimezoneLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TIMEZONE_LABELS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

// Weather settings. Keyless (Open-Meteo) so there's nothing secret to store;
// persisted in localStorage and synced across windows like the timezones.
const WEATHER_ENABLED_KEY = "weatherEnabled"
const WEATHER_LOCATION_KEY = "weatherLocation"
const WEATHER_UNIT_KEY = "weatherUnit"
const WEATHER_AUTO_KEY = "weatherAuto"

export type WeatherUnit = "celsius" | "fahrenheit"

function loadWeatherEnabled(): boolean {
  return localStorage.getItem(WEATHER_ENABLED_KEY) !== "false"
}
function loadWeatherLocation(): string {
  return localStorage.getItem(WEATHER_LOCATION_KEY) ?? ""
}
function loadWeatherUnit(): WeatherUnit {
  return localStorage.getItem(WEATHER_UNIT_KEY) === "fahrenheit" ? "fahrenheit" : "celsius"
}
// Auto-detect the location from IP (re-checked hourly, so it follows you when
// travelling). Defaults on; migrates pre-existing setups where a non-empty
// manual location implied manual mode.
function loadWeatherAuto(): boolean {
  const raw = localStorage.getItem(WEATHER_AUTO_KEY)
  if (raw !== null) return raw !== "false"
  return loadWeatherLocation().trim() === ""
}

// Auto update preference. Persisted in localStorage and synced across windows
// via a cross-window event, mirroring the weather/timezone pattern.
const AUTO_UPDATE_KEY = "autoUpdate"
const AUTO_UPDATE_ENABLED_CHANGED = "auto-update-enabled-changed"

function loadAutoUpdate(): boolean {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== "false"
}

// How many all-day event lanes are shown in the week view before the region
// collapses behind an expand toggle. 1–10, default 3.
const ALL_DAY_VISIBLE_KEY = "allDayVisibleCount"
const ALL_DAY_VISIBLE_CHANGED = "all-day-visible-count-changed"
export const ALL_DAY_VISIBLE_MIN = 1
export const ALL_DAY_VISIBLE_MAX = 10
export const ALL_DAY_VISIBLE_DEFAULT = 3

function clampAllDayVisible(n: number): number {
  if (!Number.isFinite(n)) return ALL_DAY_VISIBLE_DEFAULT
  return Math.max(ALL_DAY_VISIBLE_MIN, Math.min(ALL_DAY_VISIBLE_MAX, Math.round(n)))
}
function loadAllDayVisibleCount(): number {
  const raw = localStorage.getItem(ALL_DAY_VISIBLE_KEY)
  return raw === null ? ALL_DAY_VISIBLE_DEFAULT : clampAllDayVisible(Number(raw))
}

interface SettingsContextType {
  timeFormat: TimeFormat
  setTimeFormat: (tf: TimeFormat) => Promise<void>
  defaultReminders: number[]
  setDefaultReminders: (mins: number[]) => Promise<void>
  defaultCalendar: string | null
  setDefaultCalendar: (slug: string | null) => Promise<void>
  calendarDir: string
  setCalendarDir: (path: string) => Promise<void>
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => Promise<void>
  autoSyncEnabled: boolean
  setAutoSyncEnabled: (enabled: boolean) => Promise<void>
  startAtLogin: boolean
  setStartAtLogin: (enabled: boolean) => Promise<void>
  extraTimezones: string[]
  setExtraTimezones: (zones: string[]) => Promise<void>
  timezoneLabels: Record<string, string>
  setTimezoneLabel: (tz: string, label: string) => Promise<void>
  weatherEnabled: boolean
  setWeatherEnabled: (enabled: boolean) => Promise<void>
  weatherLocation: string
  setWeatherLocation: (location: string) => Promise<void>
  weatherAutoLocation: boolean
  setWeatherAutoLocation: (auto: boolean) => Promise<void>
  weatherUnit: WeatherUnit
  setWeatherUnit: (unit: WeatherUnit) => Promise<void>
  autoUpdate: boolean
  setAutoUpdate: (enabled: boolean) => Promise<void>
  allDayVisibleCount: number
  setAllDayVisibleCount: (count: number) => Promise<void>
  reloadSettings: () => Promise<void>
  // False until persisted settings load, so startup consumers don't act on defaults.
  settingsLoaded: boolean
}

const SettingsContext = createContext({} as SettingsContextType)

export function useSettings() {
  return useContext(SettingsContext)
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>("24h")
  const [defaultReminders, setDefaultRemindersState] = useState<number[]>([])
  const [defaultCalendar, setDefaultCalendarState] = useState<string | null>(null)
  const [calendarDir, setCalendarDirState] = useState<string>("")
  const [notificationsEnabled, setNotificationsEnabledState] = useState<boolean>(true)
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(true)
  const [startAtLogin, setStartAtLoginState] = useState<boolean>(false)
  const [extraTimezones, setExtraTimezonesState] = useState<string[]>(loadExtraTimezones)
  const [timezoneLabels, setTimezoneLabelsState] =
    useState<Record<string, string>>(loadTimezoneLabels)
  const [weatherEnabled, setWeatherEnabledState] = useState<boolean>(loadWeatherEnabled)
  const [weatherLocation, setWeatherLocationState] = useState<string>(loadWeatherLocation)
  const [weatherAutoLocation, setWeatherAutoLocationState] = useState<boolean>(loadWeatherAuto)
  const [weatherUnit, setWeatherUnitState] = useState<WeatherUnit>(loadWeatherUnit)
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(loadAutoUpdate)
  const [allDayVisibleCount, setAllDayVisibleCountState] = useState<number>(loadAllDayVisibleCount)
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false)

  const reloadSettings = useCallback(async () => {
    try {
      const [tf, reminders, cal, dir, notifs, autoSync, startLogin] = await Promise.all([
        rpc.caldir.get_time_format(),
        rpc.caldir.get_default_reminders(),
        rpc.caldir.get_default_calendar(),
        rpc.caldir.get_calendar_dir(),
        rpc.config.get_notifications_enabled(),
        rpc.config.get_auto_sync_enabled(),
        rpc.config.get_start_at_login(),
      ])
      setTimeFormatState(tf)
      setDefaultRemindersState(reminders)
      setDefaultCalendarState(cal)
      setCalendarDirState(dir)
      setNotificationsEnabledState(notifs)
      setAutoSyncEnabledState(autoSync)
      setStartAtLoginState(startLogin)
      setSettingsLoaded(true)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void reloadSettings()

    const unlistenTimeFormat = listen<TimeFormat>(TIME_FORMAT_CHANGED, (event) => {
      setTimeFormatState(event.payload)
    })
    const unlistenReminders = listen<number[]>(DEFAULT_REMINDERS_CHANGED, (event) => {
      setDefaultRemindersState(event.payload)
    })
    const unlistenDefaultCalendar = listen<string | null>(DEFAULT_CALENDAR_CHANGED, (event) => {
      setDefaultCalendarState(event.payload)
    })
    const unlistenCalendarDir = listen<string>(CALENDAR_DIR_CHANGED, (event) => {
      setCalendarDirState(event.payload)
    })
    const unlistenNotifications = listen<boolean>(NOTIFICATIONS_ENABLED_CHANGED, (event) => {
      setNotificationsEnabledState(event.payload)
    })
    const unlistenAutoSync = listen<boolean>(AUTO_SYNC_ENABLED_CHANGED, (event) => {
      setAutoSyncEnabledState(event.payload)
    })
    const unlistenStartAtLogin = listen<boolean>(START_AT_LOGIN_CHANGED, (event) => {
      setStartAtLoginState(event.payload)
    })
    const unlistenExtraTimezones = listen<string[]>(EXTRA_TIMEZONES_CHANGED, (event) => {
      setExtraTimezonesState(event.payload)
    })
    const unlistenTzLabels = listen<Record<string, string>>(TIMEZONE_LABELS_CHANGED, (event) => {
      setTimezoneLabelsState(event.payload)
    })
    const unlistenWeather = listen<{
      enabled: boolean
      location: string
      auto: boolean
      unit: WeatherUnit
    }>(WEATHER_SETTINGS_CHANGED, (event) => {
      setWeatherEnabledState(event.payload.enabled)
      setWeatherLocationState(event.payload.location)
      setWeatherAutoLocationState(event.payload.auto)
      setWeatherUnitState(event.payload.unit)
    })
    const unlistenAutoUpdate = listen<boolean>(AUTO_UPDATE_ENABLED_CHANGED, (event) => {
      setAutoUpdateState(event.payload)
    })
    const unlistenAllDayVisible = listen<number>(ALL_DAY_VISIBLE_CHANGED, (event) => {
      setAllDayVisibleCountState(clampAllDayVisible(event.payload))
    })

    return () => {
      unlistenTimeFormat.then((fn) => fn())
      unlistenReminders.then((fn) => fn())
      unlistenDefaultCalendar.then((fn) => fn())
      unlistenCalendarDir.then((fn) => fn())
      unlistenNotifications.then((fn) => fn())
      unlistenAutoSync.then((fn) => fn())
      unlistenStartAtLogin.then((fn) => fn())
      unlistenExtraTimezones.then((fn) => fn())
      unlistenTzLabels.then((fn) => fn())
      unlistenWeather.then((fn) => fn())
      unlistenAutoUpdate.then((fn) => fn())
      unlistenAllDayVisible.then((fn) => fn())
    }
  }, [reloadSettings])

  const setTimeFormat = async (tf: TimeFormat) => {
    setTimeFormatState(tf)
    await rpc.caldir.set_time_format(tf)
    await emit(TIME_FORMAT_CHANGED, tf)
  }

  const setDefaultReminders = async (mins: number[]) => {
    setDefaultRemindersState(mins)
    await rpc.caldir.set_default_reminders(mins)
    await emit(DEFAULT_REMINDERS_CHANGED, mins)
  }

  const setDefaultCalendar = async (slug: string | null) => {
    setDefaultCalendarState(slug)
    await rpc.caldir.set_default_calendar(slug)
    await emit(DEFAULT_CALENDAR_CHANGED, slug)
  }

  const setCalendarDir = async (path: string) => {
    await rpc.caldir.set_calendar_dir(path)
    const stored = await rpc.caldir.get_calendar_dir()
    setCalendarDirState(stored)
    await emit(CALENDAR_DIR_CHANGED, stored)
  }

  const setNotificationsEnabled = async (enabled: boolean) => {
    setNotificationsEnabledState(enabled)
    await rpc.config.set_notifications_enabled(enabled)
    await emit(NOTIFICATIONS_ENABLED_CHANGED, enabled)
  }

  const setAutoSyncEnabled = async (enabled: boolean) => {
    setAutoSyncEnabledState(enabled)
    await rpc.config.set_auto_sync_enabled(enabled)
    await emit(AUTO_SYNC_ENABLED_CHANGED, enabled)
  }

  const setStartAtLogin = async (enabled: boolean) => {
    setStartAtLoginState(enabled)
    try {
      await rpc.config.set_start_at_login(enabled)
    } catch (e) {
      console.error(e)
    }
    // Reflect the real autostart-entry state in case enable/disable failed.
    const actual = await rpc.config.get_start_at_login()
    setStartAtLoginState(actual)
    await emit(START_AT_LOGIN_CHANGED, actual)
  }

  const setExtraTimezones = async (zones: string[]) => {
    const next = zones.slice(0, MAX_EXTRA_TIMEZONES)
    setExtraTimezonesState(next)
    localStorage.setItem(EXTRA_TIMEZONES_KEY, JSON.stringify(next))
    await emit(EXTRA_TIMEZONES_CHANGED, next)
  }

  const setTimezoneLabel = async (tz: string, label: string) => {
    const next = { ...timezoneLabels }
    const trimmed = label.trim()
    if (trimmed) next[tz] = trimmed
    else delete next[tz]
    setTimezoneLabelsState(next)
    localStorage.setItem(TIMEZONE_LABELS_KEY, JSON.stringify(next))
    await emit(TIMEZONE_LABELS_CHANGED, next)
  }

  const emitWeather = (enabled: boolean, location: string, auto: boolean, unit: WeatherUnit) =>
    emit(WEATHER_SETTINGS_CHANGED, { enabled, location, auto, unit })

  const setWeatherEnabled = async (enabled: boolean) => {
    setWeatherEnabledState(enabled)
    localStorage.setItem(WEATHER_ENABLED_KEY, String(enabled))
    await emitWeather(enabled, weatherLocation, weatherAutoLocation, weatherUnit)
  }

  const setWeatherLocation = async (location: string) => {
    setWeatherLocationState(location)
    localStorage.setItem(WEATHER_LOCATION_KEY, location)
    await emitWeather(weatherEnabled, location, weatherAutoLocation, weatherUnit)
  }

  const setWeatherAutoLocation = async (auto: boolean) => {
    setWeatherAutoLocationState(auto)
    localStorage.setItem(WEATHER_AUTO_KEY, String(auto))
    await emitWeather(weatherEnabled, weatherLocation, auto, weatherUnit)
  }

  const setWeatherUnit = async (unit: WeatherUnit) => {
    setWeatherUnitState(unit)
    localStorage.setItem(WEATHER_UNIT_KEY, unit)
    await emitWeather(weatherEnabled, weatherLocation, weatherAutoLocation, unit)
  }

  const setAutoUpdate = async (enabled: boolean) => {
    setAutoUpdateState(enabled)
    localStorage.setItem(AUTO_UPDATE_KEY, String(enabled))
    await emit(AUTO_UPDATE_ENABLED_CHANGED, enabled)
  }

  const setAllDayVisibleCount = async (count: number) => {
    const next = clampAllDayVisible(count)
    setAllDayVisibleCountState(next)
    localStorage.setItem(ALL_DAY_VISIBLE_KEY, String(next))
    await emit(ALL_DAY_VISIBLE_CHANGED, next)
  }

  return (
    <SettingsContext.Provider
      value={{
        timeFormat,
        setTimeFormat,
        defaultReminders,
        setDefaultReminders,
        defaultCalendar,
        setDefaultCalendar,
        calendarDir,
        setCalendarDir,
        notificationsEnabled,
        setNotificationsEnabled,
        autoSyncEnabled,
        setAutoSyncEnabled,
        startAtLogin,
        setStartAtLogin,
        extraTimezones,
        setExtraTimezones,
        timezoneLabels,
        setTimezoneLabel,
        weatherEnabled,
        setWeatherEnabled,
        weatherLocation,
        setWeatherLocation,
        weatherAutoLocation,
        setWeatherAutoLocation,
        weatherUnit,
        setWeatherUnit,
        autoUpdate,
        setAutoUpdate,
        allDayVisibleCount,
        setAllDayVisibleCount,
        reloadSettings,
        settingsLoaded,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}
