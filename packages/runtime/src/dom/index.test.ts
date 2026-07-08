import assert from "node:assert/strict"
import { test } from "node:test"
import { mountSurface, type SurfaceEvent } from "./index.js"
import type { CapabilityCall, CapabilityResult } from "../types.js"
import { protocolChannel } from "./protocol.js"
import {
  asDomElement,
  createMountTarget,
  deferred,
  diceDescriptor,
  dispatchSandboxMessage,
  flushAsync,
  mountedIframe,
  sandboxCapabilityMessage,
  testSurface,
} from "./test-support.test-support.js"

void test("mountSurface renders a sandboxed iframe and replaces/disposes it", () => {
  const { element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<button>Roll</button>`)
  const second = testSurface([diceDescriptor], `<button>Roll</button>`)
  const instance = mountSurface(asDomElement(element), first, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  assert.equal(instance.surface, first)
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts allow-forms")
  assert.match(iframe.srcdoc, /<button>Roll<\/button>/)

  instance.replace(second)
  assert.equal(instance.surface, second)
  assert.match(iframe.srcdoc, new RegExp(second.id))

  instance.dispose()
  assert.equal(element.querySelector("iframe"), null)
})

void test("mountSurface brokers granted capability calls through transport", async () => {
  const { window, element } = createMountTarget()
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
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

  dispatchSandboxMessage(window, iframe, sandboxCapabilityMessage(current))
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
  const current = testSurface([], `<button>Roll</button>`)
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

  dispatchSandboxMessage(window, iframe, sandboxCapabilityMessage(current))
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
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const events: SurfaceEvent[] = []
  mountSurface(asDomElement(element), current, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
    maxHeight: 320,
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: current.id,
    height: 999,
  })
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
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

void test("mountSurface aborts and drops pending results after replacing a surface", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<button>Roll</button>`)
  const second = testSurface([diceDescriptor], `<button>Roll</button>`)
  const result = deferred<CapabilityResult>()
  const events: SurfaceEvent[] = []
  let signal: AbortSignal | undefined
  const instance = mountSurface(asDomElement(element), first, {
    transport: async (_call, options) => {
      signal = options.signal
      return result.promise
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, sandboxCapabilityMessage(first))
  await flushAsync()
  assert.equal(signal?.aborted, false)
  instance.replace(second)
  assert.equal(signal?.aborted, true)
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
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const result = deferred<CapabilityResult>()
  const events: SurfaceEvent[] = []
  let signal: AbortSignal | undefined
  const instance = mountSurface(asDomElement(element), current, {
    transport: async (_call, options) => {
      signal = options.signal
      return result.promise
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, sandboxCapabilityMessage(current))
  await flushAsync()
  assert.equal(signal?.aborted, false)
  instance.dispose()
  assert.equal(signal?.aborted, true)
  result.resolve({ ok: true, value: { total: 6 } })
  await flushAsync()

  assert.deepEqual(
    events.map((event) => event.type),
    ["call"],
  )
  assert.equal(element.querySelector("iframe"), null)
})
