import { useId, useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"

import { cn } from "@/lib/utils"

import { GoogleMeetIcon } from "@/icons/google-meet"
import { VideoIcon } from "@/icons/video"

import { ConferenceLink } from "./ConferenceLink"

function isMeetUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("meet.google.com")
  } catch {
    return false
  }
}

/**
 * Loose link check for the custom URL field: the scheme is optional, but we
 * require at least a domain (a host with a dotted TLD, or localhost). So
 * "meet.example.com/abc" is fine, "hello" is not.
 */
function isLikelyUrl(raw: string): boolean {
  const v = raw.trim()
  if (!v) return true // empty = no conference, not an error
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`
  try {
    const { hostname } = new URL(withScheme)
    return hostname === "localhost" || /\.[a-z]{2,}$/i.test(hostname)
  } catch {
    return false
  }
}

/**
 * Attach a video conference to an event.
 *
 *  - "Google Meet" checkbox (Google calendars with the feature connected):
 *    auto-mints a real Meet link on save via the Calendar REST API.
 *  - A free-form "video call URL" field for any other conferencing service.
 *
 * When Google Meet is enabled it wins: the custom URL is greyed out and struck
 * through (the Meet link is what gets shared with guests). The value persists as
 * the event's conference link (X-GOOGLE-CONFERENCE) and shows via ConferenceLink.
 */
export const ConferenceInput = ({
  value,
  onChange,
  onClose,
  readOnly,
  createGoogleMeet,
  onCreateGoogleMeetChange,
  canCreateMeet,
}: {
  value?: string | null
  onChange: (url: string) => void
  onClose?: () => void
  readOnly?: boolean
  createGoogleMeet?: boolean
  onCreateGoogleMeetChange?: (create: boolean) => void
  canCreateMeet?: boolean
}) => {
  const id = useId()
  // Only surface the "not a link" prompt once the field has been left, and clear
  // it again while the user is actively editing.
  const [touched, setTouched] = useState(false)

  if (readOnly) return null

  // An existing conference link (auto-created Meet or pasted Meet URL) is shown
  // as the same Join button as the read view, with a Remove action. `isMeetUrl`
  // only matches a complete URL, so this never triggers while typing below.
  if (value && isMeetUrl(value)) {
    return (
      <div className="flex flex-col gap-1">
        <ConferenceLink url={value} />
        <button
          type="button"
          onClick={() => {
            onChange("")
            onCreateGoogleMeetChange?.(false)
          }}
          className="self-start px-3 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          Remove Google Meet
        </button>
      </div>
    )
  }

  const meetOn = !!canCreateMeet && !!createGoogleMeet
  const urlInvalid = !meetOn && touched && !!value && !isLikelyUrl(value)

  return (
    <div className="flex flex-col gap-1">
      {canCreateMeet && (
        <>
          <div className="flex items-center gap-2 px-3 pl-0 h-control-height">
            <InputGroupAddon>
              <Checkbox
                id={id}
                checked={meetOn}
                className="cursor-pointer"
                onCheckedChange={(c) => onCreateGoogleMeetChange?.(c === true)}
              />
            </InputGroupAddon>

            <Label
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 text-muted-foreground",
                meetOn && "text-foreground",
              )}
            >
              <GoogleMeetIcon className="size-4 shrink-0" />
              Google Meet
            </Label>
          </div>

          {meetOn && (
            <span className="px-3 pl-9 text-xs text-muted-foreground">
              A Meet link will be created on save and shared with guests.
            </span>
          )}
        </>
      )}

      {/* Custom video-call URL — disabled + struck through when Meet is on, since
          the Meet link is shared with guests instead of this URL. */}
      <div className={cn(meetOn && "opacity-50")}>
        <InputGroup>
          <InputGroupAddon>
            <VideoIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="url"
            placeholder="Video call URL"
            value={value ?? ""}
            disabled={meetOn}
            aria-invalid={urlInvalid}
            className={cn("pl-2", meetOn && value && "line-through")}
            onChange={(e) => {
              onChange(e.target.value)
              setTouched(false)
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (value && !isLikelyUrl(value)) {
                  setTouched(true) // show the prompt instead of submitting
                  return
                }
                onClose?.()
              }
            }}
          />
        </InputGroup>
      </div>

      {urlInvalid && (
        <span className="px-3 pl-9 text-xs text-destructive">
          Enter a valid link (e.g. meet.example.com).
        </span>
      )}

      {meetOn && value && (
        <span className="px-3 pl-9 text-xs text-muted-foreground">
          This URL won’t be used — the Google Meet link is shared instead.
        </span>
      )}
    </div>
  )
}
