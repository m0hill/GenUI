import { renderActionIntent } from "@genui/genui"
import { mount, type Mounted, type SurfaceEvent } from "@genui/genui/dom"
import { actionError, parseActionResult, parseSurface } from "@genui/protocol"
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
const confirmedCalls = new Set<string>()
let mounted: Mounted | undefined

const showStatus = (message: string, error = false): void => {
  status.textContent = message
  status.dataset.error = String(error)
}

const appendEvent = (event: SurfaceEvent): void => {
  const item = document.createElement("li")
  item.textContent = JSON.stringify(event, null, 2)
  eventLog.append(item)
}

const transport = async (
  call: Parameters<Parameters<typeof mount>[2]["transport"]>[0],
  options: Parameters<Parameters<typeof mount>[2]["transport"]>[1],
) => {
  const approved = confirmedCalls.delete(call.callId)
  const response = await fetch("/genui/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ call, approved }),
    signal: options.signal,
  })
  const result = parseActionResult(await response.json())
  return result ?? actionError("execution_failed", "Host returned an invalid action result.")
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
  confirmedCalls.clear()
  eventLog.replaceChildren()
  mounted = mount(surfaceRoot, surface, {
    maxHeight: 720,
    transport,
    confirm: (action, call) => {
      const intent =
        action.intent === undefined
          ? action.description
          : renderActionIntent(action.intent, call.input)
      const approved = window.confirm(`${intent}\n\nInput:\n${JSON.stringify(call.input, null, 2)}`)
      if (approved) confirmedCalls.add(call.callId)
      return approved
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
