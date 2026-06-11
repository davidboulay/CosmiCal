import { openUrl } from "@tauri-apps/plugin-opener"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { useSettings } from "@/contexts/SettingsContext"

import { useUpdateCheck, type UpdateCheckStatus } from "@/hooks/useUpdateCheck"

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

  const { info } = status
  if (!info.hasUpdate) {
    return (
      <span className="text-xs text-muted-foreground">
        You're up to date (version {info.currentVersion}).
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">
        Version {info.latestVersion} is available (you have {info.currentVersion}).
      </span>
      <div className="flex items-center gap-2">
        {info.debUrl && (
          <Button variant="secondary" onClick={() => void openUrl(info.debUrl!)}>
            Download .deb
          </Button>
        )}
        <Button variant="ghost" onClick={() => void openUrl(info.releaseUrl)}>
          View release
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Installing a .deb needs administrator rights, so CosmiCal can't update itself automatically
        — download the package above and install it (e.g. with your software center or{" "}
        <code>sudo apt install ./CosmiCal.deb</code>).
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
