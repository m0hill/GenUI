import { mount, type Mounted } from "genui/dom"
import { actionError, parseSurface } from "genui/protocol"
import { guestErrorFixture, ordersDashboardFixture } from "./fixtures.js"
import {
  parseApprovalResponse,
  parseExecuteEnvelope,
  type PlaygroundEvent,
} from "./playground-codecs.js"

const requiredElement = <ElementType extends Element>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector)
  if (element === null) throw new Error(`Missing playground element: ${selector}`)
  return element
}

const editor = requiredElement<HTMLTextAreaElement>("#surface-source")
const form = requiredElement<HTMLFormElement>("#surface-form")
const surfaceRoot = requiredElement<HTMLElement>("#surface")
const eventLog = requiredElement<HTMLOListElement>("#event-log")
const status = requiredElement<HTMLOutputElement>("#host-status")
let mounted: Mounted | undefined
const approvalTokens = new Map<string, string>()
const retryTokens = new Map<string, string>()
const callKey = (surfaceId: string, callId: string): string => JSON.stringify([surfaceId, callId])

const showStatus = (message: string, error = false): void => {
  status.textContent = message
  status.dataset.error = String(error)
}

const appendEvent = (event: PlaygroundEvent): void => {
  const item = document.createElement("li")
  item.textContent = JSON.stringify(event, null, 2)
  eventLog.append(item)
}

const transport: Parameters<typeof mount>[2]["transport"] = async (call, options) => {
  const key = callKey(call.surfaceId, call.callId)
  const retryToken = retryTokens.get(key)
  retryTokens.delete(key)
  const response = await fetch("/genui/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      call,
      ...(retryToken === undefined ? {} : { approvalRetryToken: retryToken }),
    }),
    signal: options.signal,
  })
  const envelope = parseExecuteEnvelope(await response.json())
  if (envelope === undefined) {
    return actionError("execution_failed", "Host returned an invalid action result.")
  }
  if (envelope.approvalToken === undefined) approvalTokens.delete(key)
  else approvalTokens.set(key, envelope.approvalToken)
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
  approvalTokens.clear()
  retryTokens.clear()
  eventLog.replaceChildren()
  mounted = mount(surfaceRoot, surface, {
    maxHeight: 720,
    transport,
    capabilities: {
      sendMessage: ({ role, content }) => {
        appendEvent({
          type: "host_capability",
          capability: "sendMessage",
          provenance: "generated_surface",
          role,
          textLength: content.text.length,
        })
        return Promise.resolve()
      },
      updateModelContext: ({ content, structuredContent }) => {
        appendEvent({
          type: "host_capability",
          capability: "updateModelContext",
          provenance: "generated_surface",
          contentLength: content?.length ?? 0,
          structuredContentKeys: Object.keys(structuredContent ?? {}),
        })
        return Promise.resolve()
      },
      openLink: ({ url }) => {
        appendEvent({
          type: "host_capability",
          capability: "openLink",
          provenance: "generated_surface",
          url,
        })
        if (!window.confirm(`Generated surface requested this URL:\n\n${url}`)) {
          return Promise.reject(new Error("Link opening denied."))
        }
        window.open(url, "_blank", "noopener,noreferrer")
        return Promise.resolve()
      },
    },
    confirm: async (_action, call, intent) => {
      const key = callKey(call.surfaceId, call.callId)
      const token = approvalTokens.get(key)
      approvalTokens.delete(key)
      if (token === undefined) throw new Error("Host did not issue an approval token.")
      if (!window.confirm(intent)) return false
      const response = await fetch("/genui/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surfaceId: call.surfaceId, callId: call.callId, token }),
      })
      if (!response.ok) throw new Error("Host could not register action approval.")
      const approval = parseApprovalResponse(await response.json())
      if (approval === undefined) throw new Error("Host returned an invalid approval response.")
      retryTokens.set(key, approval.retryToken)
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
