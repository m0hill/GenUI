import { renderGeneratedHtml } from "./generated-html.js"
import { createGenuiManifest, type GenuiRuntimeManifest } from "../../genui/default-primitives.js"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const sandboxCsp = [
  "default-src 'none'",
  // Datastar compiles data-* expressions with Function; the iframe sandbox and broker own authority.
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline'",
  "img-src https:",
  "base-uri 'none'",
  "connect-src https://cdn.jsdelivr.net",
  "font-src 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join("; ")

const sandboxStyles = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-width: 0;
  background: transparent;
}

body {
  overflow-wrap: anywhere;
}

img,
svg,
video,
canvas {
  max-width: 100%;
}

a {
  color: inherit;
}

button,
input,
select,
textarea {
  font: inherit;
}
`.trim()

const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003C").replaceAll(">", "\\u003E")

const sandboxBridgeScript = (manifest: GenuiRuntimeManifest): string =>
  `
import { action, attribute, effect, mergePaths } from "${DATASTAR_RUNTIME}"

const CHANNEL = "hono-ai.generated-ui.v1"
const BACKTICK = String.fromCharCode(96)
const DOUBLE_QUOTE = String.fromCharCode(34)
const MANIFEST = ${scriptJson(manifest)}
let sequence = 0

const allowedCapabilities = new Set(MANIFEST.capabilities.map((capability) => capability.name))

const patchBridgeSignals = (entries) => {
  mergePaths(entries)
}

const setSignal = (path, value) => {
  if (
    typeof path !== "string" ||
    !/^_?[A-Za-z][A-Za-z0-9_]*(\\._?[A-Za-z][A-Za-z0-9_]*)*$/.test(path)
  ) {
    return
  }
  mergePaths([[path, value]])
}

const toastRoot = () => {
  let root = document.getElementById("genui-toast-root")
  if (root !== null) return root

  root = document.createElement("div")
  root.id = "genui-toast-root"
  root.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;display:grid;gap:8px;max-width:min(320px,calc(100vw - 24px));pointer-events:none"
  document.body.append(root)
  return root
}

const showToast = (input) => {
  const message =
    typeof input === "string"
      ? input
      : typeof input?.message === "string"
        ? input.message
        : ""
  if (message.trim().length === 0) return

  const toast = document.createElement("output")
  toast.textContent = message.slice(0, 180)
  toast.style.cssText = "display:block;border:1px solid rgba(15,23,42,.16);border-radius:8px;background:#111827;color:white;box-shadow:0 10px 30px rgba(15,23,42,.18);padding:10px 12px;font:500 13px/1.35 system-ui,sans-serif"
  toastRoot().append(toast)
  setTimeout(() => toast.remove(), 2600)
}

const postHeight = () => {
  const height = Math.ceil(Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.offsetHeight,
  ))
  window.parent.postMessage({ channel: CHANNEL, type: "resize", height }, "*")
}

const requestCapability = (capability, input) => {
  if (!allowedCapabilities.has(capability)) {
    patchBridgeSignals([
      ["_capabilityName", capability],
      ["_capabilityStatus", "error"],
      ["_capabilityError", "Capability is not leased to this UI."],
      ["_capabilityResult", ""],
    ])
    return
  }

  const requestId = String(++sequence)
  patchBridgeSignals([
    ["_capabilityName", capability],
    ["_capabilityStatus", "pending"],
    ["_capabilityError", ""],
    ["_capabilityResult", ""],
  ])
  window.parent.postMessage(
    { channel: CHANNEL, type: "request", requestId, capability, input: input ?? {} },
    "*",
  )
}

const boundSignalValues = () => {
  const values = new Map()
  for (const element of document.querySelectorAll("[data-bind]")) {
    const name = element.getAttribute("data-bind")
    if (typeof name !== "string" || name.length === 0) continue
    if ("value" in element && typeof element.value === "string") values.set(name, element.value)
  }
  return values
}

const unquote = (value) => {
  try {
    if (value.startsWith('"')) return JSON.parse(value)
  } catch {}

  const body = value.slice(1, -1)
  return body
    .replaceAll("\\\\'", "'")
    .replaceAll('\\\\\\\\"', '"')
    .replaceAll("\\\\\\\\", "\\\\")
    .replaceAll("\\\\" + BACKTICK, BACKTICK)
}

const promptFromExpression = (expression) => {
  const pattern = new RegExp(
    "prompt\\\\s*:\\\\s*('(?:\\\\\\\\.|[^'])*'|" +
      DOUBLE_QUOTE +
      "(?:\\\\\\\\.|[^" +
      DOUBLE_QUOTE +
      "])*" +
      DOUBLE_QUOTE +
      "|" +
      BACKTICK +
      "(?:\\\\\\\\.|\\\\$\\\\{[^}]*\\\\}|[^" +
      BACKTICK +
      "])*" +
      BACKTICK +
      ")",
  )
  const match = pattern.exec(expression)
  if (match === null) return undefined

  const literal = match[1]
  if (literal === undefined) return undefined

  if (!literal.startsWith(BACKTICK)) return unquote(literal)

  const signals = boundSignalValues()
  return literal
    .slice(1, -1)
    .replace(/\\$\\{\\s*\\$([A-Za-z_][A-Za-z0-9_.]*)\\s*\\}/g, (_source, name) => {
      const value = signals.get(name)
      return typeof value === "string" ? value : ""
    })
    .replaceAll("\\\\" + BACKTICK, BACKTICK)
    .replaceAll("\\\\\\\\", "\\\\")
}

const splitTopLevel = (source) => {
  const parts = []
  let current = ""
  let quote = ""
  let depth = 0
  let escaped = false

  for (const character of source) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === "\\\\") {
      current += character
      escaped = true
      continue
    }

    if (quote.length > 0) {
      current += character
      if (character === quote) quote = ""
      continue
    }

    if (character === "'" || character === DOUBLE_QUOTE || character === BACKTICK) {
      current += character
      quote = character
      continue
    }

    if (character === "{" || character === "[" || character === "(") depth += 1
    if (character === "}" || character === "]" || character === ")") depth -= 1

    if (character === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
      continue
    }

    current += character
  }

  if (current.trim().length > 0) parts.push(current.trim())
  return parts
}

const valueFromExpression = (source) => {
  const value = source.trim()
  if (value.length === 0) return undefined
  if (value.startsWith("'") || value.startsWith(DOUBLE_QUOTE) || value.startsWith(BACKTICK)) {
    return promptFromExpression("prompt: " + value)
  }
  if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) return Number(value)
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null

  const signal = /^\\$([A-Za-z_][A-Za-z0-9_.]*)$/.exec(value)?.[1]
  if (signal !== undefined) return boundSignalValues().get(signal) ?? ""

  return undefined
}

const inputFromObjectExpression = (source) => {
  const body = source.trim()
  if (!body.startsWith("{") || !body.endsWith("}")) return undefined

  const input = {}
  for (const part of splitTopLevel(body.slice(1, -1))) {
    const index = part.indexOf(":")
    if (index === -1) return undefined

    const key = part.slice(0, index).trim().replace(/^['"]|['"]$/g, "")
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined

    input[key] = valueFromExpression(part.slice(index + 1))
  }
  return input
}

const capabilityRequestFromExpression = (expression) => {
  const source = expression.trim()
  const match = /^@capability\\(\\s*(["'])([^"']+)\\1\\s*,\\s*([\\s\\S]*)\\)\\s*$/.exec(source)
  const capability = match?.[2]
  const inputSource = match?.[3]
  if (capability === undefined || inputSource === undefined) return undefined
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(capability)) return undefined

  const input = inputFromObjectExpression(inputSource)
  if (input === undefined) return undefined
  return { capability, input }
}

const requestFromExpression = (expression) => {
  const source = expression.trim()
  const isLegacyChatPost = /^@post\\(\\s*(["'])\\/chat\\1\\s*,/.test(source) && /\\bprompt\\s*:/.test(source)
  if (isLegacyChatPost) {
    const prompt = promptFromExpression(expression)
    requestCapability("chat.follow_up", { prompt })
    return true
  }

  const request = capabilityRequestFromExpression(expression)
  if (request === undefined) return false

  requestCapability(request.capability, request.input)
  return true
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const trigger = target.closest("[data-on\\\\:click]")
    const expression = trigger?.getAttribute("data-on:click")
    if (typeof expression === "string" && requestFromExpression(expression)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const submitter = target.closest("button,input")
    if (
      submitter instanceof HTMLElement &&
      (submitter.tagName === "BUTTON" || submitter.getAttribute("type") === "submit") &&
      submitter.getAttribute("type") !== "button"
    ) {
      const form = submitter.closest("form")
      const submitExpression = form?.getAttribute("data-on:submit__prevent")
      if (typeof submitExpression === "string" && requestFromExpression(submitExpression)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
  },
  true,
)

document.addEventListener(
  "submit",
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const expression = target.getAttribute("data-on:submit__prevent")
    if (typeof expression === "string" && requestFromExpression(expression)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (typeof expression === "string") return

    event.preventDefault()
    event.stopPropagation()
  },
  true,
)

action({
  name: "setSignal",
  apply(_ctx, path, value) {
    setSignal(path, value)
  },
})

action({
  name: "toast",
  apply(_ctx, input) {
    showToast(input)
  },
})

action({
  name: "capability",
  apply(_ctx, capability, input = {}) {
    if (typeof capability !== "string") {
      patchBridgeSignals([
        ["_capabilityStatus", "error"],
        ["_capabilityError", "Capability name must be a string."],
      ])
      return
    }
    requestCapability(capability, input)
  },
})

attribute({
  name: "focus-when",
  requirement: { key: "denied", value: "must" },
  returnsValue: true,
  apply({ el, rx }) {
    const stop = effect(() => {
      if (!rx()) return

      queueMicrotask(() => {
        if (document.contains(el) && typeof el.focus === "function") {
          el.focus({ preventScroll: true })
        }
      })
    })

    return stop
  },
})

window.addEventListener("message", (event) => {
  const message = event.data
  if (typeof message !== "object" || message === null) return
  if (message.channel !== CHANNEL || message.type !== "result") return

  if (message.ok === true) {
    patchBridgeSignals([
      ["_capabilityName", message.capability ?? ""],
      ["_capabilityStatus", "complete"],
      ["_capabilityError", ""],
      ["_capabilityResult", message.result ?? ""],
    ])
    return
  }

  patchBridgeSignals([
    ["_capabilityName", message.capability ?? ""],
    ["_capabilityStatus", "error"],
    ["_capabilityError", typeof message.error === "string" ? message.error : "Capability failed."],
  ])
})

window.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const link = target.closest("a[href]")
  if (link instanceof HTMLAnchorElement) {
    event.preventDefault()
    window.parent.postMessage(
      { channel: CHANNEL, type: "link", href: link.href, label: link.textContent ?? "" },
      "*",
    )
  }
})

new ResizeObserver(postHeight).observe(document.documentElement)
window.addEventListener("load", postHeight)
queueMicrotask(postHeight)
`.trim()

const escapeHtmlText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const escapeHtmlAttribute = (value: string): string =>
  escapeHtmlText(value).replaceAll('"', "&quot;")

/**
 * Builds the sandbox document used as iframe srcdoc for model-generated UI.
 */
export const renderGeneratedUiSandboxDocument = (
  html: string,
  manifest: GenuiRuntimeManifest = createGenuiManifest(undefined),
): string => {
  const safeBody = renderGeneratedHtml(html, {
    allowedActions: new Set(manifest.actions.map((action) => action.name)),
    allowedCapabilities: new Set(manifest.capabilities.map((capability) => capability.name)),
    allowedPluginAttributes: new Set(
      manifest.pluginAttributes.map((attribute) => attribute.name.toLowerCase()),
    ),
  })

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(sandboxCsp)}">`,
    `<style>${escapeHtmlText(sandboxStyles)}</style>`,
    `<script type="module">${sandboxBridgeScript(manifest)}</script>`,
    "</head>",
    "<body data-signals=\"{ _capabilityName: '', _capabilityStatus: '', _capabilityError: '', _capabilityResult: '' }\">",
    safeBody,
    "</body>",
    "</html>",
  ].join("")
}
