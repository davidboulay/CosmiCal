import { openUrl } from "@tauri-apps/plugin-opener"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { useSettings } from "@/contexts/SettingsContext"

import { checkForUpdate, installUpdate, restartApp } from "@/lib/updates"

// Checks for a newer release on launch (when auto-update is on) and surfaces it
// as a toast with a one-click Install. Renders nothing. The Settings → About
// page offers the same controls plus a manual check.
export function UpdateNotifier() {
  const { autoUpdate, settingsLoaded } = useSettings()
  const checked = useRef(false)

  useEffect(() => {
    if (!settingsLoaded || !autoUpdate || checked.current) return
    checked.current = true

    void (async () => {
      try {
        const info = await checkForUpdate()
        if (!info.hasUpdate) return

        toast(`CosmiCal ${info.latestVersion} is available`, {
          description: `You have ${info.currentVersion}.`,
          duration: Infinity,
          action: info.debUrl
            ? { label: "Install", onClick: () => void runInstall(info.debUrl!, info.latestVersion) }
            : { label: "View", onClick: () => void openUrl(info.releaseUrl) },
        })
      } catch {
        // Network/API hiccup — stay quiet; the About page surfaces errors.
      }
    })()
  }, [autoUpdate, settingsLoaded])

  return null
}

async function runInstall(debUrl: string, version: string) {
  const id = toast.loading(`Downloading and installing ${version}…`)
  try {
    await installUpdate(debUrl)
    toast.success("Update installed — restarting…", { id, duration: 3000 })
    setTimeout(() => void restartApp(), 1500)
  } catch (e) {
    toast.error("Update failed", {
      id,
      description: e instanceof Error ? e.message : String(e),
    })
  }
}
