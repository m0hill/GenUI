import {
  mount,
  type McpUiStyleVariableKey,
  type Mounted,
  type UpdateModelContextParams,
} from "genui/dom"
import { actionError, parseActionResult, parseSurface } from "genui/protocol"

const hostStyleVariables = {
  "--color-background-primary": "#faf9f6",
  "--color-background-secondary": "#f2f0eb",
  "--color-background-tertiary": "#e8e5de",
  "--color-background-inverse": "#20201e",
  "--color-background-ghost": "transparent",
  "--color-background-info": "#e8eef2",
  "--color-background-danger": "#f5e6e2",
  "--color-background-success": "#e5eee8",
  "--color-background-warning": "#f4ecd8",
  "--color-background-disabled": "#e2dfd8",
  "--color-text-primary": "#20201e",
  "--color-text-secondary": "#5e5b55",
  "--color-text-tertiary": "#77736b",
  "--color-text-inverse": "#faf9f6",
  "--color-text-info": "#31566a",
  "--color-text-danger": "#8a2929",
  "--color-text-success": "#3f7652",
  "--color-text-warning": "#795c1b",
  "--color-text-disabled": "#99958d",
  "--color-border-primary": "#aaa69c",
  "--color-border-secondary": "#cbc7bd",
  "--color-border-tertiary": "#d8d4cb",
  "--color-border-inverse": "#262624",
  "--color-border-info": "#7894a2",
  "--color-border-danger": "#a13232",
  "--color-border-success": "#5f866b",
  "--color-border-warning": "#a8863c",
  "--color-border-disabled": "#d1cdc3",
  "--color-ring-primary": "#b45135",
  "--color-ring-secondary": "#6d6a63",
  "--color-ring-info": "#52788c",
  "--color-ring-danger": "#a13232",
  "--color-ring-success": "#3f7652",
  "--color-ring-warning": "#96742e",
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
  "--border-radius-md": "7px",
  "--border-radius-lg": "10px",
  "--border-radius-xl": "14px",
  "--border-radius-full": "999px",
  "--border-width-regular": "1px",
  "--shadow-hairline": "0 0 0 1px rgba(32, 32, 30, 0.08)",
  "--shadow-sm": "0 2px 8px rgba(47, 44, 39, 0.08)",
  "--shadow-md": "0 12px 30px rgba(47, 44, 39, 0.12)",
  "--shadow-lg": "0 20px 48px rgba(47, 44, 39, 0.16)",
} satisfies Partial<Record<McpUiStyleVariableKey, string>>

const mounted = new Map<Element, Mounted>()
const composer = document.querySelector<HTMLFormElement>(".composer")
const prompt = document.querySelector<HTMLTextAreaElement>('textarea[data-bind="prompt"]')
const modelContext = document.querySelector<HTMLInputElement>('input[data-bind="modelContext"]')

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
    headers: { "content-type": "application/json" },
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

const executeAction: Parameters<typeof mount>[2]["transport"] = async (call, options) => {
  const response = await fetch("/genui/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(call),
    signal: options.signal,
  })
  const result = parseActionResult(await response.json())
  return result ?? actionError("execution_failed", "The GenUI action returned an invalid result.")
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
  let snapshot: Parameters<typeof mount>[2]["snapshot"]
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

let submitAfterSnapshots = false
let snapshotCapturePending = false
composer?.addEventListener(
  "submit",
  (event) => {
    if (submitAfterSnapshots) {
      submitAfterSnapshots = false
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (snapshotCapturePending) return
    snapshotCapturePending = true

    void persistSnapshots()
      .then(() => {
        submitAfterSnapshots = true
        composer.requestSubmit()
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Generated interface state could not be saved."
        const errorElement = document.querySelector("#composer-error")
        if (errorElement !== null) errorElement.textContent = message
      })
      .finally(() => {
        snapshotCapturePending = false
      })
  },
  { capture: true },
)

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
