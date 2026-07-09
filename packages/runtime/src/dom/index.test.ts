import assert from "node:assert/strict"
import { test } from "node:test"
import type { ActionCall, ActionResult } from "../types.js"
import { mount, type SurfaceEvent } from "./index.js"
import { protocolChannel } from "./protocol.js"
import {
  asDomElement,
  createMountTarget,
  deferred,
  diceDescriptor,
  dispatchSandboxMessage,
  flushAsync,
  mountedIframe,
  sandboxActionMessage,
  testSurface,
} from "./test-support.test-support.js"

void test("mount renders isolated code with bootstrap before verbatim content", async () => {
  const { element } = createMountTarget()
  const content = `<button id="run">Run</button><script type="module">window.ready = true</script>`
  const first = testSurface([diceDescriptor], content)
  const second = testSurface([diceDescriptor], `<p>Replacement</p>`)
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts allow-forms")
  assert.equal(iframe.getAttribute("referrerpolicy"), "no-referrer")
  assert.equal(iframe.srcdoc.includes(content), true)
  assert.ok(iframe.srcdoc.indexOf("Object.defineProperty(window") < iframe.srcdoc.indexOf(content))
  assert.match(
    iframe.srcdoc,
    /default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'/,
  )

  await instance.replace(second)
  assert.equal(instance.surface, second)
  assert.match(iframe.srcdoc, /Replacement/)
  instance.dispose()
  assert.equal(element.querySelector("iframe"), null)
})

void test("mount sends the grant and kills a self-navigating frame", () => {
  const { window, element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const surface = testSurface([diceDescriptor], `<p>Safe surface</p>`)
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

  iframe.dispatchEvent(new window.Event("load"))
  assert.equal(element.querySelector("iframe"), null)
  assert.equal(
    element.querySelector('[role="alert"]')?.textContent,
    "Generated UI navigation blocked.",
  )
  assert.deepEqual(events, [{ type: "violation", reason: "navigation" }])
  instance.dispose()
})

void test("mount applies image policies and brokered resize", () => {
  for (const [imagePolicy, expected] of [
    [undefined, "img-src 'none'"],
    ["data", "img-src data:"],
    ["https", "img-src https:"],
    ["https-and-data", "img-src https: data:"],
  ] as const) {
    const { window, element } = createMountTarget()
    const surface = testSurface([], `<img alt="fixture">`)
    const instance = mount(asDomElement(element), surface, {
      ...(imagePolicy === undefined ? {} : { imagePolicy }),
      maxHeight: 320,
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })
    const iframe = mountedIframe(element)
    assert.match(iframe.srcdoc, new RegExp(expected.replaceAll("'", "\\'")))

    dispatchSandboxMessage(window, iframe, {
      channel: protocolChannel,
      type: "resize",
      surfaceId: surface.id,
      height: 999,
    })
    assert.equal(iframe.style.height, "320px")
    instance.dispose()
  }
})

void test("mount brokers granted calls and rejects ungranted calls", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([diceDescriptor], `<button>Roll</button>`)
  const calls: ActionCall[] = []
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    transport: async (call): Promise<ActionResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, sandboxActionMessage(surface))
  dispatchSandboxMessage(window, iframe, {
    ...sandboxActionMessage(surface, "secrets.read"),
    callId: "call-2",
  })
  await flushAsync()

  assert.deepEqual(calls, [
    { surfaceId: surface.id, callId: "call-1", action: "dice.roll", input: { sides: 6 } },
  ])
  assert.equal(
    events.some((event) => event.type === "violation" && event.reason === "ungranted_call"),
    true,
  )
  instance.dispose()
})

void test("mount aborts pending transport after replace and dispose", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([diceDescriptor])
  const second = testSurface([diceDescriptor])
  const result = deferred<ActionResult>()
  let signal: AbortSignal | undefined
  const instance = mount(asDomElement(element), first, {
    transport: async (_call, options) => {
      signal = options.signal
      return result.promise
    },
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, sandboxActionMessage(first))
  await flushAsync()
  assert.equal(signal?.aborted, false)
  await instance.replace(second)
  assert.equal(signal?.aborted, true)

  dispatchSandboxMessage(window, iframe, sandboxActionMessage(second))
  await flushAsync()
  instance.dispose()
  assert.equal(signal?.aborted, true)
  result.resolve({ ok: true, value: {} })
})

void test("mount refuses unsupported surface dialects", () => {
  const { element } = createMountTarget()
  const unsupported = { ...testSurface([]), dialect: "code/1" }
  assert.throws(
    () =>
      mount(asDomElement(element), unsupported, {
        transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
      }),
    /Unsupported generated UI dialect: code\/1/,
  )
})
