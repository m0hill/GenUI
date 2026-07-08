import {
  Window,
  type BrowserWindow,
  type Element as HappyElement,
  type HTMLIFrameElement as HappyIFrameElement,
} from "happy-dom"
import type { CapabilityDescriptor, Surface } from "../types.js"
import { isRecord, jsonRoundTrip } from "../test-support.test-support.js"
import { protocolChannel } from "./protocol.js"

export { isRecord, jsonRoundTrip }

export const diceDescriptor = {
  name: "dice.roll",
  description: "Roll a die.",
  effect: "read",
  requiresApproval: false,
} satisfies CapabilityDescriptor

export const approvedDescriptor = {
  name: "notes.create",
  description: "Create a note.",
  effect: "write",
  requiresApproval: true,
} satisfies CapabilityDescriptor

export const testSurface = (capabilities: Surface["grant"]["capabilities"], html = ""): Surface => {
  const id = globalThis.crypto.randomUUID()
  return {
    id,
    html,
    grant: { surfaceId: id, capabilities },
    dialect: "genui/0",
  }
}

export const sandboxCapabilityMessage = (
  surface: Surface,
  capability = "dice.roll",
): Readonly<Record<string, unknown>> => ({
  channel: protocolChannel,
  type: "capability",
  surfaceId: surface.id,
  callId: "call-1",
  capability,
  input: { sides: 6 },
  target: "rollResult",
})

export const createSandboxWindow = (
  html: string,
): { readonly window: Window; readonly messages: unknown[] } => {
  const window = new Window()
  const messages: unknown[] = []

  window.document.body.innerHTML = html
  window.parent.postMessage = (message: unknown): void => {
    messages.push(message)
  }

  return { window, messages }
}

export const capabilityPostMessage = (
  messages: readonly unknown[],
): Readonly<Record<string, unknown>> => {
  const message = messages.find(
    (candidate) => isRecord(candidate) && candidate.type === "capability",
  )
  if (!isRecord(message)) throw new Error("Expected a capability postMessage.")
  return message
}

export const displayStyle = (element: unknown): string => {
  if (element === null || element === undefined) throw new Error("Expected an element with style.")
  // SAFETY: these fixtures select HTML elements created by happy-dom. Its Element type is not
  // assignable to lib.dom's HTMLElement even though the runtime exposes the same style API here.
  return (element as unknown as HTMLElement).style.display
}

export const createMountTarget = (): {
  readonly window: Window
  readonly element: HappyElement
} => {
  const window = new Window()
  const element = window.document.createElement("div")
  window.document.body.append(element)
  return { window, element }
}

export const asDomElement = (element: HappyElement): Element => {
  // SAFETY: happy-dom implements the DOM Element operations used by mountSurface; its TypeScript
  // classes are distinct from lib.dom classes even though the runtime API is compatible here.
  return element as unknown as Element
}

export const mountedIframe = (element: HappyElement): HappyIFrameElement => {
  const iframe = element.querySelector("iframe")
  if (iframe === null || iframe.tagName !== "IFRAME") throw new Error("Expected mounted iframe.")
  // SAFETY: the tag check above confirms this happy-dom element is an iframe instance.
  return iframe as HappyIFrameElement
}

export const flushAsync = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

export const dispatchSandboxMessage = (
  window: Window,
  iframe: HappyIFrameElement,
  data: Readonly<Record<string, unknown>>,
): void => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data,
      // SAFETY: happy-dom's contentWindow type is compatible with MessageEvent.source here.
      source: iframe.contentWindow as BrowserWindow | null,
    }),
  )
}

export const deferred = <Value>(): {
  readonly promise: Promise<Value>
  resolve(value: Value): void
} => {
  let resolvePromise: ((value: Value) => void) | undefined
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new Error("Deferred promise is not initialized.")
      resolvePromise(value)
    },
  }
}
