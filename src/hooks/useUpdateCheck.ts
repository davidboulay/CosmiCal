import { useCallback, useEffect, useRef, useState } from "react"

import { useSettings } from "@/contexts/SettingsContext"

import { checkForUpdate, type UpdateInfo } from "@/lib/updates"

export type UpdateCheckStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; info: UpdateInfo }
  | { state: "error" }

// Drives update checking for the About/Updates settings page. Exposes a manual
// `check()` and, when auto-update is enabled, runs a check on launch and then
// every 24h while mounted.
export function useUpdateCheck() {
  const { autoUpdate } = useSettings()
  const [status, setStatus] = useState<UpdateCheckStatus>({ state: "idle" })
  const inflight = useRef(false)

  const check = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    setStatus({ state: "checking" })
    try {
      const info = await checkForUpdate()
      setStatus({ state: "ok", info })
    } catch {
      setStatus({ state: "error" })
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    if (!autoUpdate) return
    void check()
    const id = setInterval(() => void check(), 24 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [autoUpdate, check])

  return { status, check }
}
