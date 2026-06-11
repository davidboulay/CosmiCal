import { InvitesBadge } from "@/components/toolbar/InvitesBadge"
import { SettingsButton } from "@/components/toolbar/SettingsButton"
import { SyncStatus } from "@/components/toolbar/SyncStatus"
import { SearchButton } from "@/components/toolbar/search/SearchButton"
import { DragRegion } from "@/components/ui/drag-region"

import { useBreakpoint } from "@/hooks/useBreakpoint"
import { useFullscreen } from "@/hooks/useFullscreen"
import { cn, isMacOS } from "@/lib/utils"

import { ComposeEventButton } from "./compose-event/ComposeEventButton"

export function SidebarToolbar() {
  const isMd = useBreakpoint("md")
  const isFullscreen = useFullscreen()

  return (
    <div
      className={cn("flex items-center gap-3 relative", {
        "pl-[78px] md:pl-0": isMacOS && !isFullscreen,
      })}
    >
      <InvitesBadge persistent />
      <SyncStatus />

      <DragRegion className="grow" />

      <ComposeEventButton />

      {!isMd && (
        <div className="flex gap-2 items-center">
          <SettingsButton />

          <div className="w-10" />

          <SearchButton />
        </div>
      )}
    </div>
  )
}
