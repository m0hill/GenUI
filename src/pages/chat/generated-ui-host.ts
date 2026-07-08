/**
 * Trusted host-side broker for sandboxed generated UI iframes.
 */
import { allGenuiCapabilityDescriptors } from "../../genui/default-primitives.js"

const capabilityDescriptorsJson = JSON.stringify(allGenuiCapabilityDescriptors()).replaceAll(
  "<",
  "\\u003C",
)

export const generatedUiHostScript = `
const CHANNEL = "hono-ai.generated-ui.v1"
const MIN_FRAME_HEIGHT = 180
const MAX_FRAME_HEIGHT = 1200
const CAPABILITIES = new Map(
  ${capabilityDescriptorsJson}.map((capability) => [capability.name, capability])
)

const isRecord = (value) => typeof value === "object" && value !== null

const frameForSource = (source) => {
  for (const frame of document.querySelectorAll("[data-generated-ui-frame]")) {
    if (frame instanceof HTMLIFrameElement && frame.contentWindow === source) return frame
  }
  return undefined
}

const postResult = (frame, requestId, result) => {
  frame.contentWindow?.postMessage(
    { channel: CHANNEL, type: "result", requestId, ...result },
    "*",
  )
}

const promptInput = () => document.querySelector("[data-chat-prompt-input]")
const composerForm = () => document.querySelector("[data-chat-composer-form]")
const chatRoot = () => document.querySelector("[data-chat-session-id]")

const currentChatId = () => {
  const root = chatRoot()
  return root instanceof HTMLElement ? root.dataset.chatSessionId ?? "" : ""
}

const frameManifest = (frame) => {
  try {
    const manifest = JSON.parse(frame.dataset.genuiManifest ?? "{}")
    return isRecord(manifest) && Array.isArray(manifest.capabilities) ? manifest : undefined
  } catch {
    return undefined
  }
}

const frameAllowsCapability = (frame, capability) => {
  const manifest = frameManifest(frame)
  if (manifest === undefined) return false

  return manifest.capabilities.some(
    (entry) => isRecord(entry) && entry.name === capability,
  )
}

const chatIsBusy = () => {
  const input = promptInput()
  return input instanceof HTMLTextAreaElement && input.disabled
}

const submitFollowUpPrompt = async (input) => {
  if (!isRecord(input) || typeof input.prompt !== "string") {
    return { ok: false, error: "chat.follow_up expects a prompt string." }
  }

  const prompt = input.prompt.trim()
  if (prompt.length === 0) return { ok: false, error: "Prompt is empty." }
  if (prompt.length > 1200) return { ok: false, error: "Prompt is too long." }
  if (chatIsBusy()) return { ok: false, error: "The chat is already generating." }

  const field = promptInput()
  const form = composerForm()
  if (!(field instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) {
    return { ok: false, error: "Chat composer is not available." }
  }

  field.value = prompt
  field.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  form.requestSubmit()
  return { ok: true, result: "Follow-up sent." }
}

const runServerCapability = async (capability, input, approved) => {
  const response = await fetch("/genui/capability", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      capability,
      input: input ?? {},
      chatId: currentChatId(),
      approved,
    }),
  })

  if (!response.ok) return { ok: false, error: "Capability request failed." }

  const result = await response.json()
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    return { ok: false, error: "Capability returned an invalid response." }
  }

  return result
}

const approveCapability = (descriptor, input) => {
  if (descriptor.requiresApproval !== true) return true

  const preview = (() => {
    try {
      return JSON.stringify(input ?? {}).slice(0, 240)
    } catch {
      return ""
    }
  })()
  const details = preview.length > 0 ? "\\n\\nInput: " + preview : ""
  return window.confirm(
    "Allow generated UI to run " +
      descriptor.name +
      "?\\n\\n" +
      descriptor.description +
      details,
  )
}

const handleCapability = async (frame, capability, input) => {
  if (!frameAllowsCapability(frame, capability)) {
    return { ok: false, error: "Capability is not leased to this UI." }
  }

  const descriptor = CAPABILITIES.get(capability)
  if (descriptor === undefined) return { ok: false, error: "Capability is not available." }

  const approved = approveCapability(descriptor, input)
  if (!approved) return { ok: false, error: "Capability was not approved." }

  if (capability === "chat.follow_up") return submitFollowUpPrompt(input)
  if (descriptor.execution === "server") return runServerCapability(capability, input, approved)

  return { ok: false, error: "Capability has no host handler." }
}

window.addEventListener("message", async (event) => {
  const message = event.data
  if (!isRecord(message) || message.channel !== CHANNEL) return

  const frame = frameForSource(event.source)
  if (frame === undefined) return

  if (message.type === "resize" && typeof message.height === "number") {
    const height = Math.min(Math.max(Math.ceil(message.height), MIN_FRAME_HEIGHT), MAX_FRAME_HEIGHT)
    frame.style.height = String(height) + "px"
    return
  }

  if (message.type === "link" && typeof message.href === "string") {
    try {
      const url = new URL(message.href)
      if (url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer")
    } catch {}
    return
  }

  if (
    message.type !== "request" ||
    typeof message.requestId !== "string" ||
    typeof message.capability !== "string"
  ) {
    return
  }

  try {
    const result = await handleCapability(frame, message.capability, message.input)
    postResult(frame, message.requestId, { capability: message.capability, ...result })
  } catch {
    postResult(frame, message.requestId, {
      capability: message.capability,
      ok: false,
      error: "Capability failed.",
    })
  }
})
`.trim()
