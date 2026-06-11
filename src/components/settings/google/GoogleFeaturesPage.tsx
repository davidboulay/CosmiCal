import { useEffect, useId, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { rpc } from "@/rpc"

export function GoogleFeaturesPage() {
  const [connected, setConnected] = useState(false)
  const [meetEnabled, setMeetEnabled] = useState(true)
  const [contactsEnabled, setContactsEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    rpc.caldir
      .google_meet_status()
      .then((s) => {
        setConnected(s.connected)
        setMeetEnabled(s.meet_enabled)
        setContactsEnabled(s.contacts_enabled)
      })
      .catch(() => {})

  useEffect(() => {
    void refresh()
  }, [])

  const connect = async () => {
    setBusy(true)
    try {
      await rpc.caldir.google_meet_connect()
      await refresh()
      toast.success("Connected your Google account")
    } catch (e) {
      toast.error("Couldn't connect", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    await rpc.caldir.google_meet_disconnect()
    await refresh()
  }

  // Optimistically update the toggles, then persist (revert on failure).
  const updateFeatures = (meet: boolean, contacts: boolean) => {
    const prevMeet = meetEnabled
    const prevContacts = contactsEnabled
    setMeetEnabled(meet)
    setContactsEnabled(contacts)
    rpc.caldir.set_google_features(meet, contacts).catch((e) => {
      setMeetEnabled(prevMeet)
      setContactsEnabled(prevContacts)
      toast.error("Couldn't update Google features", {
        description: e instanceof Error ? e.message : String(e),
      })
    })
  }

  return (
    <div className="flex flex-col gap-6 max-w-[460px]">
      <div className="flex flex-col gap-2">
        <label className="text-sm">Google account</label>
        <p className="text-xs text-muted-foreground">
          Sign in with Google once to unlock the features below — no credentials to enter. One
          connection powers Meet links and contact autocomplete.
        </p>

        <div className="flex gap-2">
          {connected ? (
            <Button variant="secondary" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button onClick={() => void connect()} disabled={busy}>
              {busy ? "Connecting…" : "Sign in with Google"}
            </Button>
          )}
        </div>

        <span className="text-xs text-muted-foreground">
          {connected
            ? "✓ Connected"
            : "Not connected. Click Sign in with Google and authorize in your browser."}
        </span>
      </div>

      {connected && (
        <div className="flex flex-col gap-3">
          <label className="text-sm">Features</label>
          <FeatureToggle
            checked={meetEnabled}
            onChange={(v) => updateFeatures(v, contactsEnabled)}
            title="Google Meet links"
            description="Add a real Google Meet link to events created on a Google calendar."
          />
          <FeatureToggle
            checked={contactsEnabled}
            onChange={(v) => updateFeatures(meetEnabled, v)}
            title="Contact autocomplete"
            description="Suggest people from your Google contacts when adding guests."
          />
        </div>
      )}
    </div>
  )
}

function FeatureToggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description: string
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5 cursor-pointer"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer text-sm">
          {title}
        </Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </div>
  )
}
