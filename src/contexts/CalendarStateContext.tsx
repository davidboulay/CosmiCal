import { emit, listen } from "@tauri-apps/api/event"
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { z } from "zod"

import { rpc } from "@/rpc"
import type { Calendar } from "@/rpc/bindings"
import {
  ACCOUNT_NAME_OVERRIDES_CHANGED,
  CALDIR_CHANGED,
  CALENDAR_COLOR_OVERRIDES_CHANGED,
  CALENDAR_DIR_CHANGED,
} from "@/rpc/events"

import { useLocalStorage } from "@/hooks/useLocalStorage"
import { logger } from "@/lib/logger"

// --- Calendars context (changes rarely) ---

interface CalendarsContextType {
  calendars: Calendar[]
  isLoadingCalendars: boolean
  reloadCalendars: () => Promise<void>
  /** Slugs of calendars the user has hidden from the views. */
  hiddenCalendarSlugs: Set<string>
  toggleCalendarVisibility: (slug: string) => void
  /** Slug of the calendar currently isolated (only it visible), or null. */
  isolatedSlug: string | null
  /**
   * Toggle "isolate" for a calendar: when turned on, only that calendar is
   * shown and all others hidden; when turned off, the prior visibility set is
   * restored.
   */
  toggleIsolate: (slug: string) => void
  /** Local color overrides keyed by calendar slug (persisted, applied on top
   * of the server-provided color). */
  calendarColorOverrides: Record<string, string>
  setCalendarColor: (slug: string, color: string) => void
  resetCalendarColor: (slug: string) => void
  /** Local display-name overrides for accounts, keyed by account identifier. */
  accountNameOverrides: Record<string, string>
  setAccountName: (account: string, name: string) => void
  resetAccountName: (account: string) => void
}

const CalendarsContext = createContext({} as CalendarsContextType)

export function useCalendars() {
  return useContext(CalendarsContext)
}

// --- Navigation context (changes on every date navigation) ---

interface CalendarNavigationContextType {
  activeDate: Date
  setActiveDate: (date: Date) => void
  navigateToDate: (date: Date) => Promise<void>
  registerScrollToDate: (fn: (date: Date, behavior?: ScrollBehavior) => void) => void
  /** Registered by the week view; scrolls the time grid to the current hour. */
  registerScrollToNow: (fn: (() => void) | null) => void
  scrollToNow: () => void
  /** Whether the current-time line is within the time grid's viewport (week/3-Day). */
  nowLineVisible: boolean
  setNowLineVisible: (visible: boolean) => void
  isNavigating: () => boolean
  setIsNavigating: (value: boolean) => void
}

const CalendarNavigationContext = createContext({} as CalendarNavigationContextType)

export function useCalendarNavigation() {
  return useContext(CalendarNavigationContext)
}

/** @deprecated Use useCalendars() or useCalendarNavigation() directly */
export function useCalendarState() {
  const calendars = useCalendars()
  const navigation = useCalendarNavigation()
  return { ...calendars, ...navigation }
}

// --- Provider ---

interface CalendarStateProviderProps {
  children: ReactNode
  initialCalendars?: Calendar[]
  initialDate?: Date
}

export function CalendarStateProvider({
  children,
  initialCalendars,
  initialDate,
}: CalendarStateProviderProps) {
  const [activeDate, setActiveDate] = useState<Date>(() => initialDate ?? new Date())
  const [baseCalendars, setBaseCalendars] = useState<Calendar[]>(() => initialCalendars ?? [])
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(() => initialCalendars === undefined)

  // Local, user-set color overrides applied on top of the server color.
  const [calendarColorOverrides, setColorOverrides] = useLocalStorage(
    "calendarColorOverrides",
    z.record(z.string(), z.string()),
    {} as Record<string, string>,
  )
  const calendars = useMemo(
    () =>
      baseCalendars.map((c) =>
        calendarColorOverrides[c.slug] ? { ...c, color: calendarColorOverrides[c.slug] } : c,
      ),
    [baseCalendars, calendarColorOverrides],
  )

  const setCalendarColor = useCallback(
    (slug: string, color: string) => {
      const next = { ...calendarColorOverrides, [slug]: color }
      setColorOverrides(next)
      void emit(CALENDAR_COLOR_OVERRIDES_CHANGED, next)
    },
    [calendarColorOverrides, setColorOverrides],
  )
  const resetCalendarColor = useCallback(
    (slug: string) => {
      const next = { ...calendarColorOverrides }
      delete next[slug]
      setColorOverrides(next)
      void emit(CALENDAR_COLOR_OVERRIDES_CHANGED, next)
    },
    [calendarColorOverrides, setColorOverrides],
  )

  // Local, user-set display names for accounts (keyed by account identifier).
  const [accountNameOverrides, setAccountNameOverrides] = useLocalStorage(
    "accountNameOverrides",
    z.record(z.string(), z.string()),
    {} as Record<string, string>,
  )
  const setAccountName = useCallback(
    (account: string, name: string) => {
      const next = { ...accountNameOverrides }
      const trimmed = name.trim()
      if (trimmed) next[account] = trimmed
      else delete next[account]
      setAccountNameOverrides(next)
      void emit(ACCOUNT_NAME_OVERRIDES_CHANGED, next)
    },
    [accountNameOverrides, setAccountNameOverrides],
  )
  const resetAccountName = useCallback(
    (account: string) => {
      const next = { ...accountNameOverrides }
      delete next[account]
      setAccountNameOverrides(next)
      void emit(ACCOUNT_NAME_OVERRIDES_CHANGED, next)
    },
    [accountNameOverrides, setAccountNameOverrides],
  )

  // These overrides are edited in the separate Settings window but must be
  // reflected live in the main window's sidebar/views. localStorage alone
  // doesn't notify other webview windows, so mirror changes over Tauri events.
  useEffect(() => {
    const unlistenNames = listen<Record<string, string>>(ACCOUNT_NAME_OVERRIDES_CHANGED, (event) =>
      setAccountNameOverrides(event.payload),
    )
    const unlistenColors = listen<Record<string, string>>(
      CALENDAR_COLOR_OVERRIDES_CHANGED,
      (event) => setColorOverrides(event.payload),
    )
    return () => {
      void unlistenNames.then((fn) => fn())
      void unlistenColors.then((fn) => fn())
    }
  }, [setAccountNameOverrides, setColorOverrides])

  const [hiddenSlugs, setHiddenSlugs] = useLocalStorage("hiddenCalendars", z.array(z.string()), [])
  const hiddenCalendarSlugs = useMemo(() => new Set(hiddenSlugs), [hiddenSlugs])

  // Isolate state: when set, `isolatedSlug` is the only visible calendar. We
  // remember the hidden set from just before isolating so we can restore it
  // exactly when isolation is turned off.
  const [isolatedSlug, setIsolatedSlug] = useState<string | null>(null)
  const preIsolateHiddenRef = useRef<string[] | null>(null)

  const toggleCalendarVisibility = useCallback(
    (slug: string) => {
      // Manually toggling visibility breaks the isolate snapshot, so drop it.
      setIsolatedSlug(null)
      preIsolateHiddenRef.current = null
      setHiddenSlugs(
        hiddenCalendarSlugs.has(slug)
          ? hiddenSlugs.filter((s) => s !== slug)
          : [...hiddenSlugs, slug],
      )
    },
    [hiddenSlugs, hiddenCalendarSlugs, setHiddenSlugs],
  )

  const toggleIsolate = useCallback(
    (slug: string) => {
      if (isolatedSlug === slug) {
        // Turning isolate off: restore the prior hidden set exactly.
        setHiddenSlugs(preIsolateHiddenRef.current ?? [])
        preIsolateHiddenRef.current = null
        setIsolatedSlug(null)
      } else {
        // Turning isolate on (or switching the isolated calendar): remember the
        // hidden set only the first time we enter isolation so we can revert to
        // the user's real choices, not a previously-isolated state.
        if (isolatedSlug === null) {
          preIsolateHiddenRef.current = hiddenSlugs
        }
        setHiddenSlugs(calendars.map((c) => c.slug).filter((s) => s !== slug))
        setIsolatedSlug(slug)
      }
    },
    [isolatedSlug, hiddenSlugs, calendars, setHiddenSlugs],
  )

  const scrollToDateRef = useRef<((date: Date, behavior?: ScrollBehavior) => void) | null>(null)
  const scrollToNowRef = useRef<(() => void) | null>(null)
  const [nowLineVisible, setNowLineVisible] = useState(false)
  const loadEventsForDateRef = useRef<((date: Date) => Promise<void>) | null>(null)
  const isNavigatingRef = useRef(true)
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadCalendarsFromStore = async () => {
    try {
      const result = await rpc.caldir.list_calendars()
      logger.debug("Calendars loaded from store:", result.length)
      setBaseCalendars(result)
    } finally {
      setIsLoadingCalendars(false)
    }
  }

  useEffect(() => {
    if (initialCalendars === undefined) {
      void loadCalendarsFromStore()
    }

    const unlistenCalendarDir = listen(CALENDAR_DIR_CHANGED, () => {
      void loadCalendarsFromStore()
    })
    const unlistenCaldir = listen(CALDIR_CHANGED, () => {
      void loadCalendarsFromStore()
    })

    return () => {
      unlistenCalendarDir.then((fn) => fn())
      unlistenCaldir.then((fn) => fn())
    }
  }, [])

  const registerScrollToDate = useCallback((fn: (date: Date) => void) => {
    scrollToDateRef.current = fn
  }, [])

  const registerScrollToNow = useCallback((fn: (() => void) | null) => {
    scrollToNowRef.current = fn
  }, [])

  const scrollToNow = useCallback(() => {
    scrollToNowRef.current?.()
  }, [])

  const isNavigating = useCallback(() => isNavigatingRef.current, [])

  const setIsNavigating = useCallback((value: boolean) => {
    isNavigatingRef.current = value
  }, [])

  const lastNavigateTimeRef = useRef(0)
  const RAPID_NAV_THRESHOLD_MS = 200

  const navigateToDate = useCallback(async (date: Date) => {
    // Cancel any pending timeout from a previous navigation
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current)
    }

    // Use instant scrolling when navigations happen in quick succession
    // to avoid stacking smooth scroll animations (causes GPU artifacts)
    const now = Date.now()
    const isRapid = now - lastNavigateTimeRef.current < RAPID_NAV_THRESHOLD_MS
    lastNavigateTimeRef.current = now
    const behavior: ScrollBehavior = isRapid ? "instant" : "smooth"

    isNavigatingRef.current = true

    // Load events for the target date first (this handles distant date navigation)
    if (loadEventsForDateRef.current) {
      await loadEventsForDateRef.current(date)
    }

    // Use requestAnimationFrame to ensure DOM has updated before scrolling
    requestAnimationFrame(() => {
      setActiveDate(date)
      scrollToDateRef.current?.(date, behavior)
    })

    // Clear flag after scroll animation completes
    navigationTimeoutRef.current = setTimeout(() => {
      isNavigatingRef.current = false
    }, 500)
  }, [])

  const calendarsValue = useMemo(
    () => ({
      calendars,
      isLoadingCalendars,
      reloadCalendars: loadCalendarsFromStore,
      hiddenCalendarSlugs,
      toggleCalendarVisibility,
      isolatedSlug,
      toggleIsolate,
      calendarColorOverrides,
      setCalendarColor,
      resetCalendarColor,
      accountNameOverrides,
      setAccountName,
      resetAccountName,
    }),
    [
      calendars,
      isLoadingCalendars,
      hiddenCalendarSlugs,
      toggleCalendarVisibility,
      isolatedSlug,
      toggleIsolate,
      calendarColorOverrides,
      setCalendarColor,
      resetCalendarColor,
      accountNameOverrides,
      setAccountName,
      resetAccountName,
    ],
  )

  const navigationValue = useMemo(
    () => ({
      activeDate,
      setActiveDate,
      navigateToDate,
      registerScrollToDate,
      registerScrollToNow,
      scrollToNow,
      nowLineVisible,
      setNowLineVisible,
      isNavigating,
      setIsNavigating,
    }),
    [activeDate, nowLineVisible],
  )

  return (
    <CalendarsContext.Provider value={calendarsValue}>
      <CalendarNavigationContext.Provider value={navigationValue}>
        {children}
      </CalendarNavigationContext.Provider>
    </CalendarsContext.Provider>
  )
}
