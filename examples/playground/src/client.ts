import type { CallAuditEntry } from "@genui/genui"
import { mount, type Mounted, type SurfaceEvent } from "@genui/genui/dom"
import { actionError, parseSurface } from "@genui/protocol"
import { parseExecuteEnvelope } from "./execute-envelope.js"
import { guestErrorFixture, ordersDashboardFixture } from "./fixtures.js"

const requiredElement = <ElementType extends Element>(selector: string): ElementType => {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`Missing playground element: ${selector}`)
  return element as ElementType
}

const editor = requiredElement<HTMLTextAreaElement>("#surface-source")
const form = requiredElement<HTMLFormElement>("#surface-form")
const surfaceRoot = requiredElement<HTMLElement>("#surface")
const eventLog = requiredElement<HTMLOListElement>("#event-log")
const status = requiredElement<HTMLOutputElement>("#host-status")
let mounted: Mounted | undefined

const showStatus = (message: string, error = false): void => {
  status.textContent = message
  status.dataset.error = String(error)
}

type PlaygroundEvent = SurfaceEvent | { readonly type: "audit"; readonly entry: CallAuditEntry }

const appendEvent = (event: PlaygroundEvent): void => {
  const item = document.createElement("li")
  item.textContent = JSON.stringify(event, null, 2)
  eventLog.append(item)
}

const transport = async (
  call: Parameters<Parameters<typeof mount>[2]["transport"]>[0],
  options: Parameters<Parameters<typeof mount>[2]["transport"]>[1],
) => {
  const response = await fetch("/genui/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ call }),
    signal: options.signal,
  })
  const envelope = parseExecuteEnvelope(await response.json())
  if (envelope === undefined) {
    return actionError("execution_failed", "Host returned an invalid action result.")
  }
  for (const entry of envelope.audit) appendEvent({ type: "audit", entry })
  return envelope.result
}

const createSurface = async (content: string): Promise<void> => {
  showStatus("Creating surface…")
  const response = await fetch("/genui/surface", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  })
  const surface = parseSurface(await response.json())
  if (!response.ok || surface === undefined) throw new Error("Host returned an invalid surface.")

  mounted?.dispose()
  eventLog.replaceChildren()
  mounted = mount(surfaceRoot, surface, {
    maxHeight: 720,
    transport,
    confirm: async (_action, call, intent) => {
      if (!window.confirm(intent)) return false
      const response = await fetch("/genui/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceId: call.surfaceId, callId: call.callId }),
      })
      if (!response.ok) throw new Error("Host could not register action approval.")
      return true
    },
    onEvent: appendEvent,
  })
  showStatus(`Mounted ${surface.id}`)
}

const run = (operation: () => Promise<void>): void => {
  void operation().catch((error: unknown) => {
    showStatus(error instanceof Error ? error.message : "Playground operation failed.", true)
  })
}

form.addEventListener("submit", (event) => {
  event.preventDefault()
  run(() => createSurface(editor.value))
})

requiredElement<HTMLButtonElement>("#fixture-orders").addEventListener("click", () => {
  editor.value = ordersDashboardFixture
  run(() => createSurface(ordersDashboardFixture))
})

requiredElement<HTMLButtonElement>("#fixture-error").addEventListener("click", () => {
  editor.value = guestErrorFixture
  run(() => createSurface(guestErrorFixture))
})

requiredElement<HTMLButtonElement>("#copy-instructions").addEventListener("click", () => {
  run(async () => {
    const response = await fetch("/genui/instructions")
    if (!response.ok) throw new Error("Could not load model instructions.")
    await navigator.clipboard.writeText(await response.text())
    showStatus("Model instructions copied.")
  })
})

editor.value = ordersDashboardFixture
