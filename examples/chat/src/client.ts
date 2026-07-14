import {
  type ActionConfirmationHandler,
  type ActionTransport,
  mount,
  type McpUiStyleVariableKey,
  type Mounted,
  type SnapshotValue,
  type SubscriptionTransport,
  SubscriptionTransportError,
  type UpdateModelContextParams,
} from "genui/dom"
import { actionError, parseSubscriptionError, parseSurface } from "genui/protocol"
import { parseExecuteEnvelope } from "./approval.js"
import { subscriptionDeliveries } from "./subscription-stream.js"

const hostStyleVariables = {
  "--color-background-primary": "#fbfbf7",
  "--color-background-secondary": "#f6f6f1",
  "--color-background-tertiary": "#f0f1ea",
  "--color-background-inverse": "#171812",
  "--color-background-ghost": "transparent",
  "--color-background-info": "#dbe5ff",
  "--color-background-danger": "#f8e3e0",
  "--color-background-success": "#e2f0e7",
  "--color-background-warning": "#f6eed6",
  "--color-background-disabled": "#e7e7dd",
  "--color-text-primary": "#171812",
  "--color-text-secondary": "#47483e",
  "--color-text-tertiary": "#7c7d70",
  "--color-text-inverse": "#fbfbf7",
  "--color-text-info": "#003ef5",
  "--color-text-danger": "#b42318",
  "--color-text-success": "#1f7a3d",
  "--color-text-warning": "#7a5c14",
  "--color-text-disabled": "#a2a396",
  "--color-border-primary": "#9f9f92",
  "--color-border-secondary": "#d8d8cd",
  "--color-border-tertiary": "#e3e3d9",
  "--color-border-inverse": "#1e1f1a",
  "--color-border-info": "#86a4ff",
  "--color-border-danger": "#d0776b",
  "--color-border-success": "#6fa585",
  "--color-border-warning": "#c4a45a",
  "--color-border-disabled": "#ddddd2",
  "--color-ring-primary": "#1b55ff",
  "--color-ring-secondary": "#7c7d70",
  "--color-ring-info": "#86a4ff",
  "--color-ring-danger": "#b42318",
  "--color-ring-success": "#1f7a3d",
  "--color-ring-warning": "#a8863c",
  "--font-sans":
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
  "--font-weight-semibold": "600",
  "--font-weight-bold": "700",
  "--font-text-xs-size": "11px",
  "--font-text-sm-size": "13px",
  "--font-text-md-size": "15px",
  "--font-text-lg-size": "18px",
  "--font-heading-xs-size": "15px",
  "--font-heading-sm-size": "18px",
  "--font-heading-md-size": "22px",
  "--font-heading-lg-size": "28px",
  "--font-heading-xl-size": "36px",
  "--font-heading-2xl-size": "44px",
  "--font-heading-3xl-size": "54px",
  "--font-text-xs-line-height": "1.4",
  "--font-text-sm-line-height": "1.5",
  "--font-text-md-line-height": "1.6",
  "--font-text-lg-line-height": "1.6",
  "--font-heading-xs-line-height": "1.3",
  "--font-heading-sm-line-height": "1.25",
  "--font-heading-md-line-height": "1.2",
  "--font-heading-lg-line-height": "1.15",
  "--font-heading-xl-line-height": "1.1",
  "--font-heading-2xl-line-height": "1.08",
  "--font-heading-3xl-line-height": "1.05",
  "--border-radius-xs": "2px",
  "--border-radius-sm": "4px",
  "--border-radius-md": "8px",
  "--border-radius-lg": "12px",
  "--border-radius-xl": "16px",
  "--border-radius-full": "999px",
  "--border-width-regular": "1px",
  "--shadow-hairline": "0 0 0 1px rgba(23, 24, 18, 0.08)",
  "--shadow-sm": "0 2px 8px rgba(23, 24, 18, 0.08)",
  "--shadow-md": "0 12px 30px rgba(23, 24, 18, 0.12)",
  "--shadow-lg": "0 20px 48px rgba(23, 24, 18, 0.16)",
} satisfies Partial<Record<McpUiStyleVariableKey, string>>

const mounted = new Map<Element, Mounted>()
const composer = document.querySelector<HTMLFormElement>(".composer")
const prompt = document.querySelector<HTMLTextAreaElement>('textarea[data-bind="prompt"]')
const modelContext = document.querySelector<HTMLInputElement>('input[data-bind="modelContext"]')
const approvals = new Map<string, { readonly token: string; approved: boolean }>()
const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="chat-csrf"]')?.content
const callKey = (surfaceId: string, callId: string): string => JSON.stringify([surfaceId, callId])

type CapturedSnapshot = {
  readonly surfaceId: string
  readonly snapshot: Exclude<Awaited<ReturnType<Mounted["snapshot"]>>, undefined>
}

const persistSnapshots = async (): Promise<void> => {
  const captures = await Promise.all(
    Array.from(mounted.values(), async (instance): Promise<CapturedSnapshot | undefined> => {
      const snapshot = await instance.snapshot()
      return snapshot === undefined ? undefined : { surfaceId: instance.surface.id, snapshot }
    }),
  )
  const snapshots = captures.filter((capture) => capture !== undefined)
  if (snapshots.length === 0) return

  const response = await fetch("/genui/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json", "x-chat-csrf": csrfToken ?? "" },
    body: JSON.stringify(snapshots),
  })
  if (!response.ok) throw new Error("Generated interface state could not be saved.")
}

const sendMessage = async (text: string): Promise<void> => {
  const message = text.trim()
  if (composer === null || prompt === null) throw new Error("The chat composer is unavailable.")
  if (prompt.disabled) throw new Error("Wait for the current response to finish.")
  if (message.length === 0 || message.length > 8_000) {
    throw new Error("Generated messages must contain between 1 and 8,000 characters.")
  }

  prompt.value = message
  prompt.dispatchEvent(new Event("input", { bubbles: true }))
  await Promise.resolve()
  composer.requestSubmit()
}

const updateModelContext = async (
  surfaceId: string,
  context: UpdateModelContextParams,
): Promise<void> => {
  if (modelContext === null) throw new Error("The chat model context is unavailable.")
  modelContext.value =
    context.content === undefined && context.structuredContent === undefined
      ? ""
      : JSON.stringify({ surfaceId, ...context })
  modelContext.dispatchEvent(new Event("input", { bubbles: true }))
  await Promise.resolve()
}

const openLink = async (url: string): Promise<void> => {
  if (!window.confirm(`Generated interface wants to open this link:\n\n${url}`)) {
    throw new Error("Link opening was cancelled.")
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (opened === null) throw new Error("The browser blocked the new tab.")
}

const executeAction: ActionTransport = async (call, options) => {
  const key = callKey(call.surfaceId, call.callId)
  const approval = approvals.get(key)
  if (approval?.approved) approvals.delete(key)
  const response = await fetch("/genui/execute", {
    method: "POST",
    headers: { "content-type": "application/json", "x-chat-csrf": csrfToken ?? "" },
    body: JSON.stringify({
      call,
      ...(approval?.approved === true ? { approvalToken: approval.token } : {}),
    }),
    signal: options.signal,
  })
  const envelope = parseExecuteEnvelope(await response.json())
  if (envelope === undefined) {
    return actionError("execution_failed", "The GenUI action returned an invalid result.")
  }
  if (envelope.approvalToken === undefined) approvals.delete(key)
  else approvals.set(key, { token: envelope.approvalToken, approved: false })
  return envelope.result
}

const confirmAction: ActionConfirmationHandler = async (_action, call, intent) => {
  const key = callKey(call.surfaceId, call.callId)
  const approval = approvals.get(key)
  if (approval === undefined) throw new Error("The host did not issue an approval token.")
  approval.approved = window.confirm(intent)
  if (!approval.approved) approvals.delete(key)
  return approval.approved
}

const subscribe: SubscriptionTransport = async (request, options) => {
  const response = await fetch("/genui/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-chat-csrf": csrfToken ?? "" },
    body: JSON.stringify(request),
    signal: options.signal,
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? parseSubscriptionError(body.error)
        : undefined
    if (error === undefined) {
      throw new SubscriptionTransportError(
        "transport_failed",
        "The GenUI subscription returned an invalid error.",
      )
    }
    throw new SubscriptionTransportError(error.code, error.message)
  }
  try {
    return { events: subscriptionDeliveries(response) }
  } catch {
    await response.body?.cancel().catch(() => undefined)
    throw new SubscriptionTransportError(
      "transport_failed",
      "The GenUI subscription returned an invalid stream.",
    )
  }
}

const surfaceElements = (node: Node): Element[] => {
  if (!(node instanceof Element)) return []
  const descendants = Array.from(node.querySelectorAll("[data-genui-surface]"))
  return node.matches("[data-genui-surface]") ? [node, ...descendants] : descendants
}

const mountSurface = (element: Element): void => {
  if (mounted.has(element)) return
  const serialized = element.getAttribute("data-genui-surface")
  if (serialized === null) return

  let input: unknown
  try {
    input = JSON.parse(serialized)
  } catch {
    element.textContent = "This generated interface could not be loaded."
    return
  }

  const surface = parseSurface(input)
  if (surface === undefined) {
    element.textContent = "This generated interface is invalid."
    return
  }

  const serializedSnapshot = element.getAttribute("data-genui-snapshot")
  let snapshot: SnapshotValue | undefined
  if (serializedSnapshot !== null) {
    try {
      snapshot = JSON.parse(serializedSnapshot)
    } catch {
      element.textContent = "This generated interface has invalid saved state."
      return
    }
  }

  const instance = mount(element, surface, {
    transport: executeAction,
    confirm: confirmAction,
    subscriptionTransport: subscribe,
    capabilities: {
      sendMessage: ({ content }) => sendMessage(content.text),
      openLink: ({ url }) => openLink(url),
      updateModelContext: (context) => updateModelContext(surface.id, context),
    },
    hostContext: {
      theme: "light",
      styles: { variables: hostStyleVariables },
      containerDimensions: { maxHeight: 720 },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: "web",
    },
    ...(snapshot === undefined ? {} : { snapshot }),
  })
  mounted.set(element, instance)
}

for (const element of document.querySelectorAll("[data-genui-surface]")) mountSurface(element)

composer?.addEventListener("submit", () => {
  void persistSnapshots().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Generated interface state could not be saved."
    const errorElement = document.querySelector("#composer-error")
    if (errorElement !== null) errorElement.textContent = message
  })
})

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.removedNodes) {
      for (const element of surfaceElements(node)) {
        mounted.get(element)?.dispose()
        mounted.delete(element)
      }
    }
    for (const node of record.addedNodes) {
      for (const element of surfaceElements(node)) mountSurface(element)
    }
  }
}).observe(document.body, { childList: true, subtree: true })
