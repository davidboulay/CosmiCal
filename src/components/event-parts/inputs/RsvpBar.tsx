import { Button } from "@/components/ui/button"

import type { ResponseStatus } from "@/rpc/bindings"

const options: { value: ResponseStatus; label: string }[] = [
  { value: "tentative", label: "Maybe" },
  { value: "declined", label: "Decline" },
  { value: "accepted", label: "Accept" },
]

/**
 * Selectable RSVP control. When `status` is provided, the button matching the
 * user's current response is highlighted so the selected state is always
 * visible — for both pending (needs-action) and already-answered invites.
 */
export function RsvpBar({
  status,
  onRsvp,
}: {
  status?: ResponseStatus | null
  onRsvp: (response: ResponseStatus) => void
}) {
  return (
    <div className="flex gap-1.5 p-3 justify-between">
      {options.map((opt) => {
        const isActive = status === opt.value
        return (
          <Button
            key={opt.value}
            size="sm"
            variant={isActive ? "default" : "secondary"}
            aria-pressed={isActive}
            onClick={() => onRsvp(opt.value)}
          >
            {opt.label}
          </Button>
        )
      })}
    </div>
  )
}
