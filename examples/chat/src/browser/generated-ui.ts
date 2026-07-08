import { mountSurface, type SurfaceTransportOptions } from "@hono-ai/genui-runtime/dom"
import type {
  CapabilityCall,
  CapabilityDescriptor,
  CapabilityErrorCode,
  CapabilityResult,
  Surface,
} from "@hono-ai/genui-runtime"

const surfaceSelector = "[data-genui-surface]"
const startupPollMs = 1_000
const startupPollLimitMs = 30_000

interface MountedSurface {
  readonly source: string
  readonly instance: ReturnType<typeof mountSurface>
}

const mountedSurfaces = new Map<Element, MountedSurface>()
let syncQueued = false
let started = false

const hasMountedIframe = (element: Element): boolean =>
  element.firstElementChild?.tagName === "IFRAME"

const capabilityErrorCodes: ReadonlySet<string> = new Set<CapabilityErrorCode>([
  "unknown_surface",
  "not_granted",
  "blocked",
  "invalid_input",
  "invalid_output",
  "approval_denied",
  "storage_unavailable",
  "execution_failed",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isCapabilityDescriptor = (value: unknown): value is CapabilityDescriptor =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.description === "string" &&
  typeof value.effect === "string" &&
  typeof value.requiresApproval === "boolean"

const isSurface = (value: unknown): value is Surface => {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string" || typeof value.html !== "string") return false
  if (typeof value.dialect !== "string") return false
  if (!isRecord(value.grant)) return false
  if (value.grant.surfaceId !== value.id) return false
  if (!Array.isArray(value.grant.capabilities)) return false
  return value.grant.capabilities.every(isCapabilityDescriptor)
}

const isCapabilityErrorCode = (value: unknown): value is CapabilityErrorCode =>
  typeof value === "string" && capabilityErrorCodes.has(value)

const parseCapabilityResult = (value: unknown): CapabilityResult | undefined => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined
  if (value.ok) return { ok: true, value: value.value }
  if (!isRecord(value.error)) return undefined
  if (!isCapabilityErrorCode(value.error.code)) return undefined
  if (typeof value.error.message !== "string") return undefined
  return { ok: false, error: { code: value.error.code, message: value.error.message } }
}

const parseSurface = (source: string | undefined): Surface | undefined => {
  if (source === undefined || source.length === 0) return undefined

  try {
    const value: unknown = JSON.parse(source)
    return isSurface(value) ? value : undefined
  } catch {
    return undefined
  }
}

const chatRoot = (): HTMLElement | undefined => {
  const root = document.querySelector("[data-chat-session-id]")
  return root instanceof HTMLElement ? root : undefined
}

const currentChatId = (): string => chatRoot()?.dataset.chatSessionId ?? ""

const promptInput = (): HTMLTextAreaElement | undefined => {
  const input = document.querySelector("[data-chat-prompt-input]")
  return input instanceof HTMLTextAreaElement ? input : undefined
}

const composerForm = (): HTMLFormElement | undefined => {
  const form = document.querySelector("[data-chat-composer-form]")
  return form instanceof HTMLFormElement ? form : undefined
}

const capabilityError = (code: CapabilityErrorCode, message: string): CapabilityResult => ({
  ok: false,
  error: { code, message },
})

const chatIsBusy = (): boolean => promptInput()?.disabled === true

const submitFollowUpPrompt = async (input: unknown): Promise<CapabilityResult> => {
  if (!isRecord(input) || typeof input.prompt !== "string") {
    return capabilityError("invalid_input", "chat.follow_up expects a prompt string.")
  }

  const prompt = input.prompt.trim()
  if (prompt.length === 0) return capabilityError("invalid_input", "Prompt is empty.")
  if (prompt.length > 1_200) return capabilityError("invalid_input", "Prompt is too long.")
  if (chatIsBusy()) return capabilityError("execution_failed", "The chat is already generating.")

  const field = promptInput()
  const form = composerForm()
  if (field === undefined || form === undefined) {
    return capabilityError("execution_failed", "Chat composer is not available.")
  }

  field.value = prompt
  field.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  form.requestSubmit()
  return { ok: true, value: "Follow-up sent." }
}

const executeServerCapability = async (
  call: CapabilityCall,
  options: SurfaceTransportOptions,
): Promise<CapabilityResult> => {
  const response = await fetch("/genui/capability", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      surfaceId: call.surfaceId,
      callId: call.callId,
      capability: call.capability,
      input: call.input ?? {},
      chatId: currentChatId(),
      approved: true,
    }),
  })

  return (
    parseCapabilityResult(await response.json().catch(() => undefined)) ??
    capabilityError("execution_failed", "Capability returned an invalid response.")
  )
}

const transport = (
  call: CapabilityCall,
  options: SurfaceTransportOptions,
): Promise<CapabilityResult> => {
  if (call.capability === "chat.follow_up") return submitFollowUpPrompt(call.input)
  return executeServerCapability(call, options)
}

const approve = (descriptor: CapabilityDescriptor, call: CapabilityCall): boolean => {
  if (!descriptor.requiresApproval) return true

  const preview = (() => {
    try {
      return JSON.stringify(call.input ?? {}).slice(0, 240)
    } catch {
      return ""
    }
  })()
  const details = preview.length > 0 ? `\n\nInput: ${preview}` : ""
  return window.confirm(
    `Allow generated UI to run ${descriptor.name}?\n\n${descriptor.description}${details}`,
  )
}

const mountSurfaceElement = (element: Element, source: string, surface: Surface): void => {
  const existing = mountedSurfaces.get(element)
  if (existing !== undefined) {
    if (existing.source === source && hasMountedIframe(element)) return

    if (hasMountedIframe(element)) {
      existing.instance.replace(surface)
      mountedSurfaces.set(element, { source, instance: existing.instance })
      return
    }

    existing.instance.dispose()
    mountedSurfaces.delete(element)
  }

  const instance = mountSurface(element, surface, {
    transport,
    approve,
    onEvent(event) {
      if (event.type === "link") window.open(event.href, "_blank", "noopener,noreferrer")
    },
  })
  mountedSurfaces.set(element, { source, instance })
}

const disposeStaleSurfaces = (): void => {
  for (const [element, mounted] of mountedSurfaces) {
    if (!element.isConnected || !element.matches(surfaceSelector)) {
      mounted.instance.dispose()
      mountedSurfaces.delete(element)
    }
  }
}

const syncGeneratedSurfaces = (): void => {
  for (const element of document.querySelectorAll(surfaceSelector)) {
    const source = element.getAttribute("data-genui-surface")
    const surface = parseSurface(source ?? undefined)
    if (source !== null && surface !== undefined) mountSurfaceElement(element, source, surface)
  }
  disposeStaleSurfaces()
}

const queueSyncGeneratedSurfaces = (): void => {
  if (syncQueued) return
  syncQueued = true
  window.setTimeout(() => {
    syncQueued = false
    syncGeneratedSurfaces()
  }, 0)
}

const start = (): void => {
  if (started) {
    queueSyncGeneratedSurfaces()
    return
  }

  if (document.body === null) {
    setTimeout(start, 0)
    return
  }

  started = true
  syncGeneratedSurfaces()

  new MutationObserver(queueSyncGeneratedSurfaces).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-genui-surface"],
  })

  const stopPollingAt = Date.now() + startupPollLimitMs
  const poll = window.setInterval(() => {
    queueSyncGeneratedSurfaces()
    if (Date.now() >= stopPollingAt) window.clearInterval(poll)
  }, startupPollMs)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true })
} else {
  start()
}
