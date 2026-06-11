import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { rpc } from "@/rpc"

import { useCalendars } from "@/contexts/CalendarStateContext"

import { useConnectProvider } from "@/hooks/useConnectProvider"
import { getProviderDisplayName, getProviderIcon } from "@/lib/providers"
import { cn } from "@/lib/utils"

import { PlusIcon } from "@/icons/plus"

import { AddAccountModal, type ModalStep } from "./AddAccountModal"
import { beginProviderConnection } from "./provider-connection"

export function AccountsPage() {
  const { calendars, reloadCalendars, accountNameOverrides, setAccountName } = useCalendars()
  const { connect } = useConnectProvider()
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [reconnectStep, setReconnectStep] = useState<ModalStep | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await rpc.caldir.remove_account(removeTarget)
      await reloadCalendars()
      setRemoveTarget(null)
    } catch (e) {
      toast.error("Couldn't remove account", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setRemoving(false)
    }
  }

  const calendarsWithAccount = calendars.filter((c) => c.account != null)
  const calendarsByAccount = Object.groupBy(calendarsWithAccount, (c) => c.account!)

  const accounts = Object.entries(calendarsByAccount).map(([account, cals]) => {
    const provider = cals?.[0]?.provider ?? null
    return { account, provider }
  })

  function reconnect(provider: string | null) {
    if (provider == null) return

    beginProviderConnection({
      provider,
      connect,
      onClose: () => setReconnectStep(null),
      onSetStep: setReconnectStep,
    }).catch((error: unknown) => {
      console.error("Failed to start provider reconnection", error)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {!!accounts.length && (
        <div className="flex flex-col gap-4">
          {accounts.map(({ account, provider }) => (
            <Account
              key={account}
              account={account}
              displayName={accountNameOverrides[account] ?? account}
              provider={provider}
              onReconnect={() => reconnect(provider)}
              onRemove={() => setRemoveTarget(account)}
              onRename={() => {
                setRenameTarget(account)
                setRenameValue(accountNameOverrides[account] ?? account)
              }}
            />
          ))}
        </div>
      )}

      {!accounts.length && (
        <div className="text-sm text-muted-foreground">No accounts connected yet.</div>
      )}

      <Button className="self-start gap-2" onClick={() => setShowAddAccount(true)}>
        <PlusIcon className="size-4" />
        Connect new account
      </Button>

      {showAddAccount && <AddAccountModal onClose={() => setShowAddAccount(false)} />}

      {reconnectStep != null && (
        <AddAccountModal onClose={() => setReconnectStep(null)} initialStep={reconnectStep} />
      )}

      <Dialog open={removeTarget != null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove account?</DialogTitle>
            <DialogDescription>
              This removes {removeTarget}'s calendars from CosmiCal and signs the account out. Your
              events stay on the server; you can reconnect anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removing} onClick={() => void confirmRemove()}>
              {removing ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget != null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
            <DialogDescription>
              Choose a display name for this account. It's stored locally and doesn't change
              anything on the server.
            </DialogDescription>
          </DialogHeader>
          <Input
            ghost={false}
            autoFocus
            value={renameValue}
            placeholder={renameTarget ?? ""}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget) {
                setAccountName(renameTarget, renameValue)
                setRenameTarget(null)
              }
            }}
          />
          <DialogFooter className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                if (renameTarget) setAccountName(renameTarget, "") // reset to default
                setRenameTarget(null)
              }}
            >
              Reset to default
            </Button>
            <Button
              onClick={() => {
                if (renameTarget) setAccountName(renameTarget, renameValue)
                setRenameTarget(null)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type AccountStatus = "pending" | "connected" | "disconnected"

const statusColors: Record<AccountStatus, string> = {
  pending: "bg-muted-foreground",
  connected: "bg-success",
  disconnected: "bg-destructive",
}

const statusLabels: Record<AccountStatus, string> = {
  pending: "Connecting...",
  connected: "Connected",
  disconnected: "Failed to connect",
}

function Account({
  account,
  displayName,
  provider,
  onReconnect,
  onRemove,
  onRename,
}: {
  account: string
  displayName: string
  provider: string | null
  onReconnect: () => void
  onRemove: () => void
  onRename: () => void
}) {
  const [status, setStatus] = useState<AccountStatus>(provider == null ? "disconnected" : "pending")

  useEffect(() => {
    if (provider == null) {
      setStatus("disconnected")
      return
    }

    let cancelled = false

    setStatus("pending")

    rpc.caldir
      .check_provider_connection(provider, account)
      .then(() => {
        if (!cancelled) setStatus("connected")
      })
      .catch((error: unknown) => {
        console.error("Failed to check provider connection", error)
        if (!cancelled) setStatus("disconnected")
      })

    return () => {
      cancelled = true
    }
  }, [account, provider])

  const ProviderIcon = getProviderIcon(provider)
  const providerLabel = getProviderDisplayName(provider)

  const statusLabel = statusLabels[status]
  const statusColor = statusColors[status]

  return (
    <div className="flex items-center gap-3">
      <div className="size-11 rounded-lg bg-secondary flex items-center justify-center shrink-0">
        <ProviderIcon className="size-6" />
      </div>

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="heading text-sm">{providerLabel}</span>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild tabIndex={-1}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  statusColor,
                  status === "pending" && "animate-pulse",
                )}
                aria-label={statusLabel}
              />
            </TooltipTrigger>
            <TooltipContent>{statusLabel}</TooltipContent>
          </Tooltip>

          <span className="text-xs text-muted-foreground truncate">{displayName}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={onRename}>
          Rename
        </Button>
        <Button variant="ghost" size="sm" onClick={onReconnect}>
          Reconnect
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-destructive hover:text-destructive"
        >
          Remove
        </Button>
      </div>
    </div>
  )
}
