import { rpc } from "@/rpc"

import type { ModalStep } from "./AddAccountModal"

export async function beginProviderConnection({
  provider,
  connect,
  onClose,
  onSetStep,
}: {
  provider: string
  connect: (providerName: string) => Promise<void>
  onClose: () => void
  onSetStep: (step: ModalStep) => void
}) {
  const info = await rpc.caldir.get_provider_connect_info(provider)

  if (info.step === "oauth_redirect" || info.step === "hosted_oauth") {
    // Close the dialog as soon as the OAuth hand-off starts. Awaiting the whole
    // connect would keep this dialog open through the initial event pull (all
    // calendars), which can take a while — so it looked "stuck" even though
    // auth had already succeeded. Calendars + events stream in via the
    // background sync / file watcher. `connect` handles its own errors.
    onClose()
    void connect(provider)
  } else if (info.step === "needs_setup") {
    onSetStep({
      kind: "setup",
      provider,
      instructions: info.instructions ?? "",
      fields: info.fields,
    })
  } else if (info.step === "credentials") {
    onSetStep({ kind: "credentials", provider, fields: info.fields })
  }
}
