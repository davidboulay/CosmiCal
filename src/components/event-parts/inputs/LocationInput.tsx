import { useEffect, useRef, useState } from "react"

import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

import { rpc } from "@/rpc"

import { cn } from "@/lib/utils"

import { PushpinIcon } from "@/icons/pushpin"

export const LocationInput = ({
  value,
  onChange,
  onClose,
  readOnly,
}: {
  value?: string | null
  onChange: (location: string) => void
  onClose?: () => void
  readOnly?: boolean
}) => {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  // Skip the search that fires right after picking a suggestion.
  const justSelectedRef = useRef(false)

  // Debounced OpenStreetMap place search as the user types (keyless, backend).
  useEffect(() => {
    const q = query.trim()
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    if (q.length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      rpc.caldir
        .search_places(q)
        .then((results) => {
          if (cancelled) return
          setSuggestions(results)
          setOpen(results.length > 0)
        })
        .catch(() => {})
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const inputGroup = (
    <InputGroup
      ref={anchorRef}
      className={cn(readOnly && "hover:border-transparent! focus-within:bg-transparent!")}
    >
      <InputGroupAddon>
        <PushpinIcon />
      </InputGroupAddon>
      <InputGroupTextarea
        placeholder="Location"
        value={value ?? ""}
        readOnly={readOnly}
        className={"hover:border-transparent! focus:bg-transparent! pl-2"}
        onChange={(e) => {
          onChange(e.target.value)
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault()
            setOpen(false)
            return
          }
          if (e.key === "Enter") {
            e.preventDefault()
            setOpen(false)
            onClose?.()
          }
        }}
      />
    </InputGroup>
  )

  if (readOnly) return inputGroup

  return (
    <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{inputGroup}</PopoverAnchor>
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
            <CommandGroup>
              {suggestions.map((place) => (
                <CommandItem
                  key={place}
                  value={place}
                  onSelect={() => {
                    justSelectedRef.current = true
                    onChange(place)
                    setQuery(place)
                    setSuggestions([])
                    setOpen(false)
                  }}
                >
                  <span className="truncate text-sm">{place}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
