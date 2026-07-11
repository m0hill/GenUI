import { mount, type Mounted } from "genui/dom"
import { actionError, parseSurface } from "genui/protocol"

const mounted = new Map<Element, Mounted>()
const composer = document.querySelector<HTMLFormElement>(".composer")
const prompt = document.querySelector<HTMLTextAreaElement>('textarea[data-bind="prompt"]')

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

  const instance = mount(element, surface, {
    transport: () =>
      Promise.resolve(actionError("not_granted", "This chat has no GenUI actions configured.")),
    capabilities: {
      sendMessage: ({ content }) => sendMessage(content.text),
    },
    hostContext: {
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      containerDimensions: { maxHeight: 720 },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: "web",
    },
  })
  mounted.set(element, instance)
}

for (const element of document.querySelectorAll("[data-genui-surface]")) mountSurface(element)

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
