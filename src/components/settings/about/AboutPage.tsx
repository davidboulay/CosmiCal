import { openUrl } from "@tauri-apps/plugin-opener"
import { useId, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { useSettings } from "@/contexts/SettingsContext"

import { useUpdateCheck, type UpdateCheckStatus } from "@/hooks/useUpdateCheck"
import { installUpdate, restartApp, type UpdateInfo } from "@/lib/updates"

import { BugIcon } from "@/icons/bug"

const ISSUES_URL = "https://github.com/davidboulay/CosmiCal/issues/new"

export function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <UpdatesSection />
      <ReportBugSection />
    </div>
  )
}

const UpdatesSection = () => {
  const { autoUpdate, setAutoUpdate } = useSettings()
  const { status, check } = useUpdateCheck()
  const id = useId()

  return (
    <div className="flex flex-col gap-3 w-[420px]">
      <label className="text-sm font-medium">Updates</label>

      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={autoUpdate}
          onCheckedChange={(checked) => void setAutoUpdate(checked === true)}
          className="cursor-pointer"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm">
          Automatically check for updates
        </Label>
      </div>
      <p className="text-xs text-muted-foreground pl-7">
        When on, CosmiCal checks GitHub for a newer release on launch and once a day.
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={status.state === "checking"}
          onClick={() => void check()}
        >
          {status.state === "checking" ? "Checking…" : "Check for updates"}
        </Button>
      </div>

      <UpdateStatusLine status={status} />
    </div>
  )
}

const UpdateStatusLine = ({ status }: { status: UpdateCheckStatus }) => {
  if (status.state === "idle") return null
  if (status.state === "checking") {
    return <span className="text-xs text-muted-foreground">Checking for updates…</span>
  }
  if (status.state === "error") {
    return (
      <span className="text-xs text-error">
        Couldn't reach GitHub to check for updates. Try again later.
      </span>
    )
  }

  return <UpdateAvailable info={status.info} />
}

const UpdateAvailable = ({ info }: { info: UpdateInfo }) => {
  const [installing, setInstalling] = useState(false)

  if (!info.hasUpdate) {
    return (
      <span className="text-xs text-muted-foreground">
        You're up to date (version {info.currentVersion}).
      </span>
    )
  }

  const install = async () => {
    if (!info.debUrl) return
    setInstalling(true)
    const id = toast.loading(`Downloading and installing ${info.latestVersion}…`)
    try {
      await installUpdate(info.debUrl)
      toast.success("Update installed — restarting…", { id, duration: 3000 })
      setTimeout(() => void restartApp(), 1500)
    } catch (e) {
      toast.error("Update failed", {
        id,
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">
        Version {info.latestVersion} is available (you have {info.currentVersion}).
      </span>
      <div className="flex items-center gap-2">
        {info.debUrl && (
          <Button disabled={installing} onClick={() => void install()}>
            {installing ? "Installing…" : "Install update"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void openUrl(info.releaseUrl)}>
          View release
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Installing needs administrator rights — a password prompt will appear. After it finishes,
        restart CosmiCal to run the new version.
      </p>
    </div>
  )
}

const ReportBugSection = () => {
  return (
    <div className="flex flex-col gap-2 w-[420px]">
      <label className="text-sm font-medium">Feedback</label>
      <p className="text-xs text-muted-foreground">
        Found a problem or have a suggestion? Open an issue on GitHub.
      </p>
      <Button
        variant="secondary"
        className="w-fit gap-1.5"
        onClick={() => void openUrl(ISSUES_URL)}
      >
        <BugIcon className="size-4" />
        Report a bug
      </Button>
    </div>
  )
}
