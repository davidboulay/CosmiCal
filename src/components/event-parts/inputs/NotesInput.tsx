import { openUrl } from "@tauri-apps/plugin-opener"
import DOMPurify from "dompurify"
import type { MouseEvent } from "react"

import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group"

import { cn } from "@/lib/utils"

// Many providers (Google especially) store event descriptions as HTML
// (links, bold, lists). Detect that so we can render it richly read-only.
const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s)

export const NotesInput = ({
  value,
  onChange,
  readOnly,
}: {
  value?: string | null
  onChange: (notes: string) => void
  readOnly?: boolean
}) => {
  const text = value ?? ""

  // Read-only: render the description as sanitized HTML so links/formatting
  // show through. Editing still uses a plain textarea over the raw source.
  if (readOnly) {
    if (!text.trim()) return null

    if (looksLikeHtml(text)) {
      const clean = DOMPurify.sanitize(text)
      const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
        const anchor = (e.target as HTMLElement).closest("a")
        const href = anchor?.getAttribute("href")
        if (href) {
          e.preventDefault()
          void openUrl(href)
        }
      }
      return (
        <div
          className={cn(
            "px-2 py-1 text-sm leading-relaxed wrap-break-word",
            "[&_a]:text-primary [&_a]:underline [&_a]:cursor-pointer",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_p]:my-1 [&_b]:font-semibold [&_strong]:font-semibold",
          )}
          onClick={onClickCapture}
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      )
    }

    return <div className="px-2 py-1 text-sm leading-relaxed whitespace-pre-wrap">{text}</div>
  }

  return (
    <InputGroup className="flex gap-2">
      <InputGroupTextarea
        placeholder="Notes"
        value={text}
        className="px-2"
        onChange={(e) => onChange(e.target.value)}
      />
    </InputGroup>
  )
}
