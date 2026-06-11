import { useEffect, useId, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { WeatherUnit } from "@/contexts/SettingsContext"
import { MAX_EXTRA_TIMEZONES, useSettings } from "@/contexts/SettingsContext"

import { getZoneAbbr, getZoneCity } from "@/lib/event-time"
import { clearWeatherCache, resolveWeatherLocation } from "@/lib/weather"

import { CloseIcon } from "@/icons/close"
import { PlusIcon } from "@/icons/plus"

export function DateTimePage() {
  return (
    <div className="flex flex-col gap-6">
      <TimeZonesSection />
      <WeatherSection />
    </div>
  )
}

type WeatherStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; label: string; source: "auto" | "manual" }
  | { state: "error" }

const WeatherSection = () => {
  const {
    weatherEnabled,
    setWeatherEnabled,
    weatherLocation,
    setWeatherLocation,
    weatherUnit,
    setWeatherUnit,
  } = useSettings()
  const [location, setLocation] = useState(weatherLocation)
  const [status, setStatus] = useState<WeatherStatus>({ state: "idle" })
  const id = useId()

  // Resolve the (possibly newly-typed) location and report what we matched, so
  // the user can confirm e.g. "Paris, France" and not Paris, US.
  const update = async () => {
    const next = location.trim()
    if (next !== weatherLocation) await setWeatherLocation(next)
    clearWeatherCache()
    setStatus({ state: "loading" })
    const resolved = await resolveWeatherLocation(next)
    setStatus(
      resolved
        ? { state: "ok", label: resolved.label, source: resolved.source }
        : { state: "error" },
    )
  }

  // Show the current location status on open.
  useEffect(() => {
    if (weatherEnabled) void update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherEnabled])

  return (
    <div className="flex flex-col gap-2 w-[400px]">
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={weatherEnabled}
          onCheckedChange={(checked) => void setWeatherEnabled(checked === true)}
          className="cursor-pointer"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm">
          Show weather in the week view
        </Label>
      </div>
      <p className="text-xs text-muted-foreground pl-7">
        Forecast from Open-Meteo (no account needed). Location is detected automatically — set a
        city or "lat,lon" below if that's wrong.
      </p>
      {weatherEnabled && (
        <div className="flex flex-col gap-3 pl-7">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm">Location</label>
            <div className="flex gap-2">
              <Input
                value={location}
                ghost={false}
                placeholder="Auto-detect (e.g. Paris or 48.85,2.35)"
                className="flex-1"
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void update()
                }}
              />
              <Button
                variant="secondary"
                disabled={status.state === "loading"}
                onClick={() => void update()}
              >
                {status.state === "loading" ? "Checking…" : "Update"}
              </Button>
            </div>
            <WeatherStatusLine status={status} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm">Temperature unit</label>
            <Select
              value={weatherUnit}
              onValueChange={(v) => void setWeatherUnit(v as WeatherUnit)}
            >
              <SelectTrigger className="w-full" ghost={false}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">Celsius (°C)</SelectItem>
                <SelectItem value="fahrenheit">Fahrenheit (°F)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

const WeatherStatusLine = ({ status }: { status: WeatherStatus }) => {
  if (status.state === "idle") return null
  if (status.state === "loading") {
    return <span className="text-xs text-muted-foreground">Checking location…</span>
  }
  if (status.state === "error") {
    return (
      <span className="text-xs text-error">
        Couldn't find that location — try a different city or use "lat,lon".
      </span>
    )
  }
  return (
    <span className="text-xs text-muted-foreground">
      📍 {status.label}
      {status.source === "auto" && " (auto-detected)"}
    </span>
  )
}

function allTimezones(): string[] {
  try {
    // Intl.supportedValuesOf is widely available; guard for older runtimes.
    const fn = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    return fn ? fn("timeZone") : []
  } catch {
    return []
  }
}

const TimeZonesSection = () => {
  const { extraTimezones, setExtraTimezones } = useSettings()
  const [open, setOpen] = useState(false)

  const options = useMemo(
    () => allTimezones().filter((tz) => !extraTimezones.includes(tz)),
    [extraTimezones],
  )
  const atMax = extraTimezones.length >= MAX_EXTRA_TIMEZONES

  return (
    <div className="flex flex-col gap-2 w-[400px]">
      <label className="text-sm">Additional time zones</label>
      <p className="text-xs text-muted-foreground">
        Show up to {MAX_EXTRA_TIMEZONES} extra zones in the week view and event details. Give each a
        custom label if you like.
      </p>

      <div className="flex flex-col gap-1.5 mt-1">
        {extraTimezones.map((tz) => (
          <TimezoneRow
            key={tz}
            tz={tz}
            onRemove={() => void setExtraTimezones(extraTimezones.filter((z) => z !== tz))}
          />
        ))}
      </div>

      {!atMax && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" className="w-fit gap-1.5">
              <PlusIcon className="size-4" />
              Add time zone
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0 w-[360px] max-h-[var(--radix-popover-content-available-height)] overflow-hidden"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Search time zone…" />
              {/* Cap the list to the space the popover actually has (minus the
                  input) so it scrolls inside the window instead of overflowing. */}
              <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-3rem))]">
                <CommandEmpty>No time zone found.</CommandEmpty>
                {options.map((tz) => (
                  <CommandItem
                    key={tz}
                    value={tz}
                    onSelect={() => {
                      void setExtraTimezones([...extraTimezones, tz])
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">
                      {getZoneCity(tz)}
                      <span className="text-muted-foreground"> · {tz}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

const TimezoneRow = ({ tz, onRemove }: { tz: string; onRemove: () => void }) => {
  const { timezoneLabels, setTimezoneLabel } = useSettings()
  const [label, setLabel] = useState(timezoneLabels[tz] ?? "")

  const commit = () => {
    if (label.trim() !== (timezoneLabels[tz] ?? "")) void setTimezoneLabel(tz, label)
  }

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 shadow-input-border">
      <Input
        value={label}
        placeholder={getZoneCity(tz)}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
        }}
        className="flex-1"
      />
      <span className="text-xs text-muted-foreground shrink-0" title={tz}>
        {getZoneCity(tz)} · {getZoneAbbr(tz)}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground cursor-default shrink-0"
        title="Remove"
        onClick={onRemove}
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  )
}
