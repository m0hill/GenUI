import assert from "node:assert/strict"
import { test } from "node:test"
import {
  Window,
  type BrowserWindow,
  type Element as HappyElement,
  type HTMLIFrameElement as HappyIFrameElement,
} from "happy-dom"
import { mountSurface, type SurfaceEvent } from "./index.js"
import type { CapabilityCall, CapabilityResult, Surface } from "../types.js"

const surface = (capabilities: Surface["grant"]["capabilities"]): Surface => {
  const id = globalThis.crypto.randomUUID()
  return {
    id,
    html: `<button>Roll</button>`,
    grant: { surfaceId: id, capabilities },
    dialect: "genui/0",
  }
}

const grantedSurface = (): Surface => {
  const id = globalThis.crypto.randomUUID()
  return {
    id,
    html: `<button>Roll</button>`,
    grant: {
      surfaceId: id,
      capabilities: [
        {
          name: "dice.roll",
          description: "Roll a die.",
          effect: "read",
          requiresApproval: false,
        },
      ],
    },
    dialect: "genui/0",
  }
}

const createMountTarget = (): { readonly window: Window; readonly element: HappyElement } => {
  const window = new Window()
  const element = window.document.createElement("div")
  window.document.body.append(element)
  return { window, element }
}

const asDomElement = (element: HappyElement): Element => {
  // SAFETY: happy-dom implements the DOM Element operations used by mountSurface; its TypeScript
  // classes are distinct from lib.dom classes even though the runtime API is compatible here.
  return element as unknown as Element
}

const mountedIframe = (element: HappyElement): HappyIFrameElement => {
  const iframe = element.querySelector("iframe")
  assert.notEqual(iframe, null)
  assert.equal(iframe?.tagName, "IFRAME")
  return iframe as HappyIFrameElement
}

const flushAsync = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

const dispatchSandboxMessage = (
  window: Window,
  iframe: HappyIFrameElement,
  data: Readonly<Record<string, unknown>>,
): void => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data,
      source: iframe.contentWindow as BrowserWindow | null,
    }),
  )
}

const deferred = <Value>(): {
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
      assert.notEqual(resolvePromise, undefined)
      resolvePromise?.(value)
    },
  }
}

void test("mountSurface renders a sandboxed iframe and updates/disposes it", () => {
  const { element } = createMountTarget()
  const first = grantedSurface()
  const second = grantedSurface()
  const instance = mountSurface(asDomElement(element), first, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  assert.equal(instance.surface, first)
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts")
  assert.match(iframe.srcdoc, /<button>Roll<\/button>/)

  instance.update(second)
  assert.equal(instance.surface, second)
  assert.match(iframe.srcdoc, new RegExp(second.id))

  instance.dispose()
  assert.equal(element.querySelector("iframe"), null)
})

void test("mountSurface brokers granted capability calls through transport", async () => {
  const { window, element } = createMountTarget()
  const current = grantedSurface()
  const events: SurfaceEvent[] = []
  const calls: CapabilityCall[] = []
  const instance = mountSurface(asDomElement(element), current, {
    transport: async (call): Promise<CapabilityResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "capability",
    surfaceId: current.id,
    callId: "call-1",
    capability: "dice.roll",
    input: { sides: 6 },
    target: "rollResult",
  })
  await flushAsync()

  assert.deepEqual(calls, [
    { surfaceId: current.id, callId: "call-1", capability: "dice.roll", input: { sides: 6 } },
  ])
  assert.deepEqual(
    events.map((event) => event.type),
    ["call", "result"],
  )
  assert.equal(events[0]?.type === "call" ? events[0].target : undefined, "rollResult")
  assert.equal(events[1]?.type === "result" ? events[1].target : undefined, "rollResult")

  instance.dispose()
})

void test("mountSurface refuses ungranted calls before transport", async () => {
  const { window, element } = createMountTarget()
  const current = surface([])
  const events: SurfaceEvent[] = []
  let transportCalled = false
  mountSurface(asDomElement(element), current, {
    transport: async (): Promise<CapabilityResult> => {
      transportCalled = true
      return { ok: true, value: {} }
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "capability",
    surfaceId: current.id,
    callId: "call-1",
    capability: "dice.roll",
    input: {},
  })
  await flushAsync()

  assert.equal(transportCalled, false)
  assert.equal(events[0]?.type === "violation" ? events[0].reason : undefined, "ungranted_call")
  assert.equal(events[1]?.type, "result")
  assert.equal(
    events[1]?.type === "result" && !events[1].result.ok ? events[1].result.error.code : undefined,
    "not_granted",
  )
})

void test("mountSurface emits link, resize, and protocol violation events", () => {
  const { window, element } = createMountTarget()
  const current = grantedSurface()
  const events: SurfaceEvent[] = []
  mountSurface(asDomElement(element), current, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
    maxHeight: 320,
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "resize",
    surfaceId: current.id,
    height: 999,
  })
  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "link",
    surfaceId: current.id,
    href: "https://example.com/",
  })
  dispatchSandboxMessage(window, iframe, {
    channel: "wrong",
    type: "resize",
    surfaceId: current.id,
    height: 20,
  })

  assert.equal(iframe.style.height, "320px")
  assert.deepEqual(events, [
    { type: "resize", height: 320 },
    { type: "link", href: "https://example.com/" },
    { type: "violation", reason: "unknown_channel" },
  ])
})

void test("mountSurface drops pending results after updating to a different surface", async () => {
  const { window, element } = createMountTarget()
  const first = grantedSurface()
  const second = grantedSurface()
  const result = deferred<CapabilityResult>()
  const events: SurfaceEvent[] = []
  const instance = mountSurface(asDomElement(element), first, {
    transport: async () => result.promise,
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "capability",
    surfaceId: first.id,
    callId: "call-1",
    capability: "dice.roll",
    input: {},
  })
  instance.update(second)
  result.resolve({ ok: true, value: { total: 6 } })
  await flushAsync()

  assert.deepEqual(
    events.map((event) => event.type),
    ["call"],
  )
  assert.equal(instance.surface, second)
})

void test("mountSurface drops pending results after dispose", async () => {
  const { window, element } = createMountTarget()
  const current = grantedSurface()
  const result = deferred<CapabilityResult>()
  const events: SurfaceEvent[] = []
  const instance = mountSurface(asDomElement(element), current, {
    transport: async () => result.promise,
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: "genui/dom/0",
    type: "capability",
    surfaceId: current.id,
    callId: "call-1",
    capability: "dice.roll",
    input: {},
  })
  instance.dispose()
  result.resolve({ ok: true, value: { total: 6 } })
  await flushAsync()

  assert.deepEqual(
    events.map((event) => event.type),
    ["call"],
  )
  assert.equal(element.querySelector("iframe"), null)
})
