import {
  Window,
  type BrowserWindow,
  type Element as HappyElement,
  type HTMLIFrameElement as HappyIFrameElement,
} from "happy-dom"
import { codeDialect, type Action, type Surface } from "../protocol/index.js"
import { isRecord, jsonRoundTrip } from "../test-support.test-support.js"
import { protocolChannel } from "./protocol.js"
import type { ActionSandboxMessage } from "./sandbox-message-schema.js"

export { isRecord, jsonRoundTrip }

export const diceDescriptor = {
  name: "dice.roll",
  description: "Roll a die.",
  effect: "read",
  requiresApproval: false,
} satisfies Action

export const approvedDescriptor = {
  name: "notes.create",
  description: "Create a note.",
  effect: "write",
  requiresApproval: true,
} satisfies Action

export const testSurface = (actions: Surface["grant"]["actions"], html = ""): Surface => {
  const id = globalThis.crypto.randomUUID()
  return {
    id,
    content: html,
    grant: { surfaceId: id, actions, subscriptions: [] },
    dialect: codeDialect,
  }
}

export const sandboxActionMessage = (
  surface: Surface,
  action = "dice.roll",
): ActionSandboxMessage => ({
  channel: protocolChannel,
  surfaceId: surface.id,
  callId: "call-1",
  action,
  input: { sides: 6 },
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
  // SAFETY: happy-dom implements the Element operations used by mount.
  return element as unknown as Element
}

export const mountedIframe = (element: HappyElement): HappyIFrameElement => {
  const iframe = element.querySelector("iframe")
  if (iframe === null || iframe.tagName !== "IFRAME") throw new Error("Expected mounted iframe.")
  // SAFETY: the tag check confirms this happy-dom element is an iframe.
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
  data: unknown,
): void => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data,
      // SAFETY: happy-dom's contentWindow is compatible with MessageEvent.source here.
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
