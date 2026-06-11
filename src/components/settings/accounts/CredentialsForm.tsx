import { openUrl } from "@tauri-apps/plugin-opener"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"

import { rpc } from "@/rpc"

import { useCalendars } from "@/contexts/CalendarStateContext"

import { useConnectProvider } from "@/hooks/useConnectProvider"
import { getProviderDisplayName } from "@/lib/providers"

import { ModalStep } from "./AddAccountModal"

export const CredentialsForm = ({
  step,
  onClose,
}: {
  step: Extract<ModalStep, { kind: "credentials" }>
  onClose: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const { connectWithCredentials, isConnecting } = useConnectProvider()
  const { calendars, setAccountName } = useCalendars()

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  // Optional, user-chosen display name (currently offered for iCloud).
  const [accountName, setAccountNameInput] = useState("")
  const showNameField = step.provider === "icloud"

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (step.kind !== "credentials") return

    const missingRequired = step.fields.filter((f) => f.required).some((f) => !fieldValues[f.id])

    if (missingRequired) {
      setError("Please fill in all required fields")
      return
    }

    // Accounts present before connecting, so we can name the new one afterward.
    const beforeAccounts = new Set(calendars.map((c) => c.account).filter((a): a is string => !!a))

    try {
      await connectWithCredentials(
        step.provider,
        Object.entries(fieldValues).map(([id, value]) => ({ id, value })),
      )

      // Apply the chosen name to the freshly-connected account.
      const name = accountName.trim()
      if (name) {
        try {
          const after = await rpc.caldir.list_calendars()
          const newAccounts = [
            ...new Set(after.map((c) => c.account).filter((a): a is string => !!a)),
          ].filter((a) => !beforeAccounts.has(a))
          if (newAccounts.length === 1) setAccountName(newAccounts[0], name)
        } catch {
          // Naming is best-effort; the account is connected regardless.
        }
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect account")
    }
  }

  return (
    <form onSubmit={handleCredentialsSubmit} noValidate className="flex flex-col gap-3 w-full">
      {step.provider === "icloud" && (
        <p className="text-xs text-muted-foreground">
          iCloud needs an app-specific password.{" "}
          <button
            type="button"
            onClick={() => void openUrl("https://account.apple.com/sign-in")}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            Create one at account.apple.com
          </button>
        </p>
      )}

      {step.fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-1">
          {field.field_type === "password" ? (
            <PasswordInput
              ghost={false}
              placeholder={field.label}
              value={fieldValues[field.id] ?? ""}
              disabled={isConnecting}
              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
            />
          ) : (
            <Input
              ghost={false}
              type="text"
              placeholder={field.label}
              value={fieldValues[field.id] ?? ""}
              disabled={isConnecting}
              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
            />
          )}
          {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
        </div>
      ))}

      {showNameField && (
        <div className="flex flex-col gap-1">
          <Input
            ghost={false}
            type="text"
            placeholder="Account name (optional)"
            value={accountName}
            disabled={isConnecting}
            onChange={(e) => setAccountNameInput(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            A friendly name for this account in CosmiCal. You can change it later in Accounts.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isConnecting} className="mt-3">
          {isConnecting ? "Connecting..." : `Connect ${getProviderDisplayName(step.provider)}`}
        </Button>
      </div>
    </form>
  )
}
