import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
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

import { rpc } from "@/rpc"
import { SyncPreview } from "@/rpc/bindings"

import { useCalendars } from "@/contexts/CalendarStateContext"
import { useSettings } from "@/contexts/SettingsContext"

const MASS_DELETE_THRESHOLD = 10

/** One calendar's live phase during a reload, mirrored from backend
 * `sync-progress` events. */
export type SyncPhase =
  | "pending"
  | "checking"
  | "checked"
  | "pulling"
  | "pushing"
  | "done"
  | "error"

export interface CalendarSyncStatus {
  phase: SyncPhase
  toPull?: number
  toPush?: number
  error?: string
}

/** Shape of the backend `sync-progress` event payload. */
interface SyncProgressEvent {
  calendar_slug: string
  phase: SyncPhase
  to_pull: number | null
  to_push: number | null
  detail: string | null
}

interface SyncContextType {
  requestSync: () => Promise<void>
  syncNow: () => Promise<void>
  /** Push/pull only the given calendars — used after a local mutation so we
   * don't loop every account. Falls back to a full check when auto-sync is off. */
  syncCalendars: (slugs: string[]) => Promise<void>
  isChecking: boolean
  isSyncing: boolean
  syncError: string | null
  pendingPreviews: SyncPreview[]
  /** Per-calendar live status for the in-flight reload, keyed by slug. */
  calendarStatuses: Record<string, CalendarSyncStatus>
  pendingMassDelete: SyncPreview[] | null
  confirmMassDelete: () => Promise<void>
  discardMassDelete: () => Promise<void>
  cancelMassDelete: () => void
}

const SyncContext = createContext({} as SyncContextType)

export function useSync() {
  return useContext(SyncContext)
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { calendars } = useCalendars()
  const { autoSyncEnabled, settingsLoaded, syncIntervalMinutes } = useSettings()

  const [isChecking, setIsChecking] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pendingPreviews, setPendingPreviews] = useState<SyncPreview[]>([])
  const [calendarStatuses, setCalendarStatuses] = useState<Record<string, CalendarSyncStatus>>({})
  const [pendingMassDelete, setPendingMassDelete] = useState<SyncPreview[] | null>(null)
  const isSyncingRef = useRef(false)
  // Timestamp of the last full sweep, to throttle focus-triggered syncs.
  const lastFullSyncRef = useRef(0)
  // Read in the stable `requestSync` callback so post-edit/post-create calls
  // honor the current toggle without changing `requestSync`'s identity.
  const autoSyncEnabledRef = useRef(autoSyncEnabled)
  useEffect(() => {
    autoSyncEnabledRef.current = autoSyncEnabled
  }, [autoSyncEnabled])

  // Read calendars through a ref so `runSync`'s identity stays stable. If it
  // depended on the `calendars` array, every calendar reload (which fires on
  // CALDIR_CHANGED — emitted by sync's own file writes) would change runSync,
  // re-fire the sync effect, and trigger another sync → an endless sync/reload
  // loop, especially when a stuck change keeps work pending.
  const calendarsRef = useRef(calendars)
  useEffect(() => {
    calendarsRef.current = calendars
  }, [calendars])

  // A stable key for the *set* of calendars (their slugs). Reloads that return
  // the same calendars produce the same key, so they don't re-trigger sync;
  // it changes only when an account/calendar is genuinely added or removed.
  const calendarKey = useMemo(
    () =>
      calendars
        .map((c) => c.slug)
        .sort()
        .join("|"),
    [calendars],
  )

  const runSync = useCallback(async (apply: boolean) => {
    const calendarSlugs = calendarsRef.current.filter((c) => c.provider !== null).map((c) => c.slug)
    if (calendarSlugs.length === 0 || isSyncingRef.current) return

    lastFullSyncRef.current = Date.now()
    isSyncingRef.current = true
    setIsChecking(true)
    setSyncError(null)
    // Seed every syncing calendar as "pending"; backend sync-progress events
    // then advance each one through checking → checked/pulling/pushing → done.
    setCalendarStatuses(
      Object.fromEntries(calendarSlugs.map((slug) => [slug, { phase: "pending" as const }])),
    )
    try {
      const previews = await rpc.caldir.sync_preview()
      const withWork = previews.filter((p) => p.to_push_count > 0 || p.to_pull_count > 0)
      setPendingPreviews(withWork)
      setIsChecking(false)

      if (!apply) {
        isSyncingRef.current = false
        return
      }

      const tripped = previews.filter((p) => p.to_push_delete_count >= MASS_DELETE_THRESHOLD)

      if (withWork.length > 0) {
        setIsSyncing(true)
        await rpc.caldir.sync([])
        setIsSyncing(false)
      }

      if (tripped.length > 0) {
        setPendingMassDelete(tripped)
        // Keep isSyncingRef true while the dialog is open so auto-syncs don't
        // pile up. confirmMassDelete / cancelMassDelete release it.
        // Leave pendingPreviews as-is so the count still reflects what's outstanding.
        return
      }

      setPendingPreviews([])
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    }
    isSyncingRef.current = false
    setIsChecking(false)
    setIsSyncing(false)
  }, [])

  const requestSync = useCallback(() => runSync(autoSyncEnabledRef.current), [runSync])
  const syncNow = useCallback(() => runSync(true), [runSync])

  // Targeted sync after a mutation: push/pull just the affected calendar(s).
  // When auto-sync is off we instead run a full check so the pending-change
  // counter still updates (the user applies changes manually).
  const syncCalendars = useCallback(
    async (slugs: string[]) => {
      const unique = [...new Set(slugs.filter(Boolean))]
      if (unique.length === 0) return
      if (!autoSyncEnabledRef.current) {
        void runSync(false)
        return
      }
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      setIsSyncing(true)
      setSyncError(null)
      setCalendarStatuses(
        Object.fromEntries(unique.map((slug) => [slug, { phase: "pending" as const }])),
      )
      try {
        for (const slug of unique) {
          await rpc.caldir.sync_calendar(slug)
        }
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : String(e))
      } finally {
        isSyncingRef.current = false
        setIsSyncing(false)
      }
    },
    [runSync],
  )

  const confirmMassDelete = useCallback(async () => {
    const tripped = pendingMassDelete
    if (tripped === null) return

    setPendingMassDelete(null)
    setIsSyncing(true)
    setSyncError(null)
    try {
      const slugs = tripped.map((t) => t.calendar_slug)
      await rpc.caldir.sync(slugs)
      setPendingPreviews((prev) => prev.filter((p) => !slugs.includes(p.calendar_slug)))
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
    }
  }, [pendingMassDelete])

  const discardMassDelete = useCallback(async () => {
    const tripped = pendingMassDelete
    if (tripped === null) return

    setPendingMassDelete(null)
    setIsSyncing(true)
    setSyncError(null)
    try {
      const slugs = tripped.map((t) => t.calendar_slug)
      await rpc.caldir.discard()
      setPendingPreviews((prev) => prev.filter((p) => !slugs.includes(p.calendar_slug)))
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
    }
  }, [pendingMassDelete])

  const cancelMassDelete = useCallback(() => {
    setPendingMassDelete(null)
    isSyncingRef.current = false
  }, [])

  // Mirror backend per-calendar sync progress into `calendarStatuses` so the
  // reload status bubble can show what each account is doing live.
  useEffect(() => {
    const unlisten = listen<SyncProgressEvent>("sync-progress", ({ payload }) => {
      setCalendarStatuses((prev) => ({
        ...prev,
        [payload.calendar_slug]: {
          phase: payload.phase,
          toPull: payload.to_pull ?? undefined,
          toPush: payload.to_push ?? undefined,
          error: payload.detail ?? undefined,
        },
      }))
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    if (!settingsLoaded || !calendarKey) return
    void runSync(autoSyncEnabled)
    // Keyed on the calendar *set*, not the array reference, so a content-only
    // reload (CALDIR_CHANGED) doesn't kick off another sync.
  }, [runSync, autoSyncEnabled, settingsLoaded, calendarKey])

  // Refresh when the window regains focus, but throttled — otherwise routine
  // focus changes (closing a dialog, alt-tabbing) would re-run the whole sweep
  // every time. The throttle tracks the configured interval but never waits
  // longer than 5 min, so returning to the window still feels fresh even when
  // the periodic interval is long.
  const focusThrottleMs = Math.min(syncIntervalMinutes * 60_000, 5 * 60_000)
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && settingsLoaded && Date.now() - lastFullSyncRef.current > focusThrottleMs) {
        void runSync(autoSyncEnabled)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [runSync, autoSyncEnabled, settingsLoaded, focusThrottleMs])

  // Gentle periodic refresh so calendars stay current even if the window is
  // never refocused and nothing is edited. Cadence is user-configurable
  // (Settings → sync interval); there's no server push, so this bounds how
  // stale incoming changes can get.
  useEffect(() => {
    if (!settingsLoaded) return
    const periodMs = syncIntervalMinutes * 60_000
    const id = setInterval(() => void runSync(autoSyncEnabledRef.current), periodMs)
    return () => clearInterval(id)
  }, [runSync, settingsLoaded, syncIntervalMinutes])

  const value = useMemo<SyncContextType>(
    () => ({
      requestSync,
      syncNow,
      syncCalendars,
      isChecking,
      isSyncing,
      syncError,
      pendingPreviews,
      calendarStatuses,
      pendingMassDelete,
      confirmMassDelete,
      discardMassDelete,
      cancelMassDelete,
    }),
    [
      requestSync,
      syncNow,
      syncCalendars,
      isChecking,
      isSyncing,
      syncError,
      pendingPreviews,
      calendarStatuses,
      pendingMassDelete,
      confirmMassDelete,
      discardMassDelete,
      cancelMassDelete,
    ],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
