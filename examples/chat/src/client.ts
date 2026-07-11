import { mount, type Mounted } from "genui/dom"
import { actionError, parseSurface } from "genui/protocol"

const mounted = new Map<Element, Mounted>()

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
