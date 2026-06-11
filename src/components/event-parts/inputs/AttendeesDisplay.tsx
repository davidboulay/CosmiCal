import { openUrl } from "@tauri-apps/plugin-opener"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { StatusDot } from "@/components/ui/status-dot"

import { EventAttendee } from "@/rpc/bindings"

import {
  type ContactSuggestion,
  filterContactSuggestions,
  useContactSuggestions,
  useGoogleContactSearch,
} from "@/hooks/useContactSuggestions"
import { cn } from "@/lib/utils"

import { CheckIcon } from "@/icons/check"
import { ChevronDownIcon } from "@/icons/chevron-down"
import { UserIcon } from "@/icons/user"

import { RemoveItemButton } from "./RemoveItemButton"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AttendeesDisplay({
  organizer,
  attendees,
  readOnly,
  onAttendeesChange,
}: {
  organizer?: EventAttendee | null
  attendees?: EventAttendee[]
  readOnly?: boolean
  onAttendeesChange?: (attendees: EventAttendee[]) => void
}) {
  const [inputValue, setInputValue] = useState("")
  const [hasInvalidEmail, setHasInvalidEmail] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const canEdit = !readOnly && !!onAttendeesChange

  const contacts = useContactSuggestions()
  const remoteContacts = useGoogleContactSearch(canEdit ? inputValue : "")

  // Merge real Google contacts (authoritative) with event-mined ones, deduped
  // by email — used for both autocomplete and resolving names below.
  const contactBook = useMemo(() => {
    const byEmail = new Map<string, ContactSuggestion>()
    for (const c of [...remoteContacts, ...contacts]) {
      const key = attendeeKey(c.email)
      const existing = byEmail.get(key)
      if (!existing) byEmail.set(key, c)
      else if (!existing.name && c.name) byEmail.set(key, c)
    }
    return byEmail
  }, [remoteContacts, contacts])

  const attendeeList = attendees ?? []
  const organizerAttendee = organizer
    ? attendeeList.find((a) => attendeeKey(a.email) === attendeeKey(organizer.email))
    : null
  const hasAttendees = attendeeList.length > 0

  // Show a known display name in place of a bare email address.
  const resolveName = (a: EventAttendee): EventAttendee => {
    if (a.name) return a
    const known = contactBook.get(attendeeKey(a.email))
    return known?.name ? { ...a, name: known.name } : a
  }

  // Addresses already in use (attendees + organizer) — hidden from suggestions.
  const usedEmails = [...attendeeList.map((a) => a.email)]
  if (organizer?.email) usedEmails.push(organizer.email)

  const suggestions = canEdit
    ? filterContactSuggestions(Array.from(contactBook.values()), inputValue, usedEmails)
    : []

  if (!hasAttendees && !canEdit) return null

  const commitAttendee = (attendee: EventAttendee) => {
    const email = attendeeKey(attendee.email)
    const exists = attendeeList.some((a) => attendeeKey(a.email) === email)
    const isOrganizer = organizer && attendeeKey(organizer.email) === email

    if (!exists && !isOrganizer) {
      onAttendeesChange?.([...attendeeList, attendee])
    }

    setInputValue("")
    setHasInvalidEmail(false)
    setSuggestionsOpen(false)
  }

  const addTypedAttendee = () => {
    const email = attendeeKey(inputValue)

    if (!email) {
      setHasInvalidEmail(false)
      return
    }

    if (!EMAIL_RE.test(email)) {
      setHasInvalidEmail(true)
      return
    }

    // If what the user typed exactly matches a known contact, keep its name.
    const known = contacts.find((c) => attendeeKey(c.email) === email)
    commitAttendee({
      name: known?.name ?? null,
      email,
      response_status: "needs-action",
    })
  }

  const removeAttendee = (email: string) => {
    onAttendeesChange?.(attendeeList.filter((attendee) => attendeeKey(attendee.email) !== email))
  }

  const editableAttendees = attendeeList.filter(
    (a) => attendeeKey(a.email) !== (organizer ? attendeeKey(organizer.email) : null),
  )

  return (
    <div className="flex flex-col">
      {organizerAttendee && (
        <AttendeeRow attendee={resolveName(organizerAttendee)} label="Organizer" />
      )}

      {editableAttendees.map((a) => (
        <AttendeeRow
          key={a.email}
          attendee={resolveName(a)}
          onRemove={canEdit ? () => removeAttendee(attendeeKey(a.email)) : undefined}
        />
      ))}

      {canEdit && hasAttendees && <ResendInvitesButton attendees={attendeeList} />}

      {canEdit && (
        <Popover open={suggestionsOpen && suggestions.length > 0} onOpenChange={setSuggestionsOpen}>
          <PopoverAnchor asChild>
            <InputGroup
              ref={anchorRef}
              className={cn("w-auto", {
                "ml-7": !!attendees?.length,
              })}
            >
              {!attendees?.length && (
                <InputGroupAddon>
                  <UserIcon />
                </InputGroupAddon>
              )}

              <InputGroupInput
                value={inputValue}
                placeholder={"Add participant"}
                className="min-w-0 px-2 text-sm"
                aria-invalid={hasInvalidEmail}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  setHasInvalidEmail(false)
                  setSuggestionsOpen(true)
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => {
                  if (inputValue.trim()) addTypedAttendee()
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSuggestionsOpen(false)
                    return
                  }
                  if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                    if (inputValue.trim()) {
                      e.preventDefault()
                      addTypedAttendee()
                    }
                  }
                }}
              />
            </InputGroup>
          </PopoverAnchor>

          <PopoverContent
            className="p-0 w-(--radix-popover-trigger-width)"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
            }}
          >
            <Command shouldFilter={false}>
              <CommandList>
                {suggestions.length ? (
                  <CommandGroup>
                    {suggestions.map((contact) => (
                      <CommandItem
                        key={contact.email}
                        value={`${contact.name ?? ""} ${contact.email}`}
                        onSelect={() =>
                          commitAttendee({
                            name: contact.name,
                            email: contact.email,
                            response_status: "needs-action",
                          })
                        }
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{contact.name ?? contact.email}</span>
                          {contact.name && (
                            <span className="text-muted-foreground truncate text-xs">
                              {contact.email}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : (
                  <CommandEmpty>No matching contacts.</CommandEmpty>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function attendeeKey(email: string) {
  return email.trim().toLowerCase()
}

function AttendeeRow({
  attendee,
  label,
  onRemove,
}: {
  attendee: EventAttendee
  label?: string
  onRemove?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasName = !!attendee.name
  const displayName = attendee.name ?? attendee.email

  return (
    <div className="flex flex-col">
      <div className="group flex items-center gap-2 py-1 px-3 text-sm">
        <StatusDot status={attendee.response_status} />

        <div className="grow gap-2 items-center flex min-w-0">
          <span className="truncate">{displayName}</span>
          {label && <span className="text-muted-foreground shrink-0">{label}</span>}
        </div>

        {onRemove && <RemoveItemButton onClick={onRemove} />}

        <button
          type="button"
          aria-label={expanded ? "Hide details" : "Show details"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground rounded-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div className="flex items-center gap-2 pl-7 pr-3 pb-1 text-xs text-muted-foreground">
          {hasName && <span className="truncate">{attendee.email}</span>}
          {!hasName && <span className="truncate">No additional details</span>}
          {hasName && <CopyButton value={attendee.email} />}
        </div>
      )}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be unavailable; fail silently.
    }
  }

  return (
    <button
      type="button"
      aria-label="Copy email address"
      onClick={copy}
      className="text-muted-foreground hover:text-foreground rounded-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  )
}

/**
 * Re-send the invite to every attendee.
 *
 * NOTE: there is no dedicated "send invite" backend command — invites are
 * delivered by the sync provider when an event with attendees is created or
 * updated. As a pragmatic re-send, this opens the user's default mail client
 * pre-addressed to all attendees so they can nudge them manually.
 */
function ResendInvitesButton({ attendees }: { attendees: EventAttendee[] }) {
  const recipients = attendees.map((a) => a.email.trim()).filter(Boolean)
  if (recipients.length === 0) return null

  const resend = () => {
    const url = `mailto:${encodeURIComponent(recipients.join(","))}?subject=${encodeURIComponent(
      "Invitation reminder",
    )}`
    void openUrl(url)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={resend}
      title="Opens your mail client addressed to all attendees (no direct invite API)"
      className="ml-7 mt-1 self-start text-muted-foreground"
    >
      Re-send invite to all
    </Button>
  )
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" />
    </svg>
  )
}
