import assert from "node:assert/strict"
import { test } from "node:test"
import { mount, type SurfaceEvent, type SurfaceSnapshot } from "./index.js"
import type { ActionCall, ActionResult } from "../types.js"
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
  testCodeSurface,
  testSurface,
} from "./test-support.test-support.js"

void test("mount renders code surfaces with bootstrap before verbatim guest content", () => {
  const { element } = createMountTarget()
  const content = `<button id="run">Run</button><script type="module">window.guestRan = true</script>`
  const surface = testCodeSurface([diceDescriptor], content)
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts allow-forms")
  assert.equal(iframe.getAttribute("referrerpolicy"), "no-referrer")
  assert.match(
    iframe.srcdoc,
    /default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'/,
  )
  assert.equal(iframe.srcdoc.includes(content), true)
  assert.ok(iframe.srcdoc.indexOf("Object.defineProperty(window") < iframe.srcdoc.indexOf(content))

  instance.dispose()
})

void test("mount handshakes code grants and trips on a second iframe load", () => {
  const { window, element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const surface = testCodeSurface([diceDescriptor], `<p>Safe surface</p>`)
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  iframe.dispatchEvent(new window.Event("load"))
  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "grant",
      surfaceId: surface.id,
      actions: surface.grant.actions,
    },
  ])
  assert.notEqual(element.querySelector("iframe"), null)

  iframe.dispatchEvent(new window.Event("load"))
  assert.equal(element.querySelector("iframe"), null)
  assert.equal(
    element.querySelector('[role="alert"]')?.textContent,
    "Generated UI navigation blocked.",
  )
  assert.deepEqual(events, [{ type: "violation", reason: "navigation" }])

  instance.dispose()
})

void test("mount renders a sandboxed iframe and replaces/disposes it", async () => {
  const { element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<button>Roll</button>`)
  const second = testSurface([diceDescriptor], `<button>Roll</button>`)
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  assert.equal(instance.surface, first)
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts allow-forms")
  assert.match(iframe.srcdoc, /<button>Roll<\/button>/)

  await instance.replace(second)
  assert.equal(instance.surface, second)
  assert.match(iframe.srcdoc, new RegExp(second.id))

  instance.dispose()
  assert.equal(element.querySelector("iframe"), null)
})

void test("mount blocks image loading by default and supports explicit image policies", () => {
  const policies = [
    { policy: undefined, expected: "img-src 'none'" },
    { policy: "none", expected: "img-src 'none'" },
    { policy: "data", expected: "img-src data:" },
    { policy: "https", expected: "img-src https:" },
    { policy: "https-and-data", expected: "img-src https: data:" },
  ] as const

  for (const { policy, expected } of policies) {
    const { element } = createMountTarget()
    const surface = testSurface([], `<img src="https://example.com/pixel.png">`)
    const instance = mount(asDomElement(element), surface, {
      ...(policy === undefined ? {} : { imagePolicy: policy }),
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })

    assert.match(mountedIframe(element).srcdoc, new RegExp(expected.replaceAll("'", "\\'")))
    instance.dispose()
  }
})

void test("mount snapshots and seeds same-surface replacement documents", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<input data-genui-bind="query">`)
  const second = { ...first, content: `<input data-genui-bind="query"><p>regenerated</p>` }
  const snapshot: SurfaceSnapshot = {
    state: { query: "draft" },
    rowStates: {},
  }
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  const captured = instance.snapshot()
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: "snapshot-1",
    snapshot,
  })
  assert.deepEqual(await captured, snapshot)

  const replacement = instance.replace(second)
  await flushAsync()
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: "snapshot-2",
    snapshot,
  })
  await replacement

  assert.match(iframe.srcdoc, /"snapshot":/)
  assert.match(iframe.srcdoc, /"query":"draft"/)
  instance.dispose()
})

void test("mount requires explicit snapshots across surface ids", async () => {
  const { element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<input data-genui-bind="query">`)
  const second = testSurface([diceDescriptor], `<input data-genui-bind="query">`)
  const third = testSurface([diceDescriptor], `<input data-genui-bind="query">`)
  const snapshot: SurfaceSnapshot = {
    state: { query: "draft" },
    rowStates: {},
  }
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  await instance.replace(second)
  assert.doesNotMatch(iframe.srcdoc, /"query":"draft"/)

  await instance.replace(third, { snapshot })
  assert.match(iframe.srcdoc, /"query":"draft"/)
  instance.dispose()
})

void test("mount emits snapshot timeout violations", async () => {
  const { element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<input data-genui-bind="query">`)
  const second = { ...first, content: `<input data-genui-bind="query"><p>regenerated</p>` }
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), first, {
    snapshotTimeoutMs: 1,
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })

  await instance.replace(second)

  assert.equal(
    events.some((event) => event.type === "violation" && event.reason === "snapshot_timeout"),
    true,
  )
  instance.dispose()
})

void test("mount serializes rapid same-surface replacements", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<p>first</p>`)
  const second = { ...first, content: `<p>second</p>` }
  const third = { ...first, content: `<p>third</p>` }
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  const secondReplacement = instance.replace(second)
  const thirdReplacement = instance.replace(third)

  await flushAsync()
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: "snapshot-1",
    snapshot: { state: { step: "first" }, rowStates: {} },
  })
  await secondReplacement
  assert.match(iframe.srcdoc, /<p>second<\/p>/)

  await flushAsync()
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: "snapshot-2",
    snapshot: { state: { step: "second" }, rowStates: {} },
  })
  await thirdReplacement

  assert.match(iframe.srcdoc, /<p>third<\/p>/)
  assert.match(iframe.srcdoc, /"step":"second"/)
  instance.dispose()
})

void test("mount refuses unsupported surface dialects", () => {
  const { element } = createMountTarget()
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const unsupported = {
    ...testSurface([diceDescriptor], `<button>Roll</button>`),
    dialect: "genui/1",
  }

  assert.throws(
    () =>
      mount(asDomElement(element), unsupported, {
        transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
      }),
    /Unsupported generated UI dialect: genui\/1/,
  )
  assert.equal(element.querySelector("iframe"), null)

  const instance = mount(asDomElement(element), current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  assert.throws(() => instance.replace(unsupported), /Unsupported generated UI dialect: genui\/1/)
  assert.equal(instance.surface, current)

  instance.dispose()
})

void test("mount brokers granted capability calls through transport", async () => {
  const { window, element } = createMountTarget()
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const events: SurfaceEvent[] = []
  const calls: ActionCall[] = []
  const instance = mount(asDomElement(element), current, {
    transport: async (call): Promise<ActionResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, sandboxCapabilityMessage(current))
  await flushAsync()

  assert.deepEqual(calls, [
    { surfaceId: current.id, callId: "call-1", action: "dice.roll", input: { sides: 6 } },
  ])
  assert.deepEqual(
    events.map((event) => event.type),
    ["call", "result"],
  )
  assert.equal(events[0]?.type === "call" ? events[0].target : undefined, "rollResult")
  assert.equal(events[1]?.type === "result" ? events[1].target : undefined, "rollResult")

  instance.dispose()
})

void test("mount refuses ungranted calls before transport", async () => {
  const { window, element } = createMountTarget()
  const current = testSurface([], `<button>Roll</button>`)
  const events: SurfaceEvent[] = []
  let transportCalled = false
  mount(asDomElement(element), current, {
    transport: async (): Promise<ActionResult> => {
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

void test("mount emits link, resize, and protocol violation events", () => {
  const { window, element } = createMountTarget()
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const events: SurfaceEvent[] = []
  mount(asDomElement(element), current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
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

void test("mount aborts and drops pending results after replacing a surface", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([diceDescriptor], `<button>Roll</button>`)
  const second = testSurface([diceDescriptor], `<button>Roll</button>`)
  const result = deferred<ActionResult>()
  const events: SurfaceEvent[] = []
  let signal: AbortSignal | undefined
  const instance = mount(asDomElement(element), first, {
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
  await instance.replace(second)
  assert.equal(signal?.aborted, true)
  result.resolve({ ok: true, value: { total: 6 } })
  await flushAsync()

  assert.deepEqual(
    events.map((event) => event.type),
    ["call"],
  )
  assert.equal(instance.surface, second)
})

void test("mount drops pending results after dispose", async () => {
  const { window, element } = createMountTarget()
  const current = testSurface([diceDescriptor], `<button>Roll</button>`)
  const result = deferred<ActionResult>()
  const events: SurfaceEvent[] = []
  let signal: AbortSignal | undefined
  const instance = mount(asDomElement(element), current, {
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
