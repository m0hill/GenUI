import assert from "node:assert/strict"
import { test } from "node:test"
import type { ActionCall, ActionResult } from "../protocol/index.js"
import {
  mount,
  type HostContext,
  type McpUiStyleVariableKey,
  type SendMessageParams,
  type SurfaceEvent,
} from "./index.js"
import { protocolChannel } from "./protocol.js"
import {
  asDomElement,
  createMountTarget,
  deferred,
  diceDescriptor,
  dispatchSandboxMessage,
  flushAsync,
  isRecord,
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

void test("mount renders trusted host theme variables before guest content", () => {
  const { element } = createMountTarget()
  const content = `<p id="themed">Themed surface</p>`
  const surface = testSurface([], content)
  const instance = mount(asDomElement(element), surface, {
    hostContext: {
      theme: "dark",
      styles: {
        variables: {
          "--color-background-primary": "light-dark(#ffffff, #171717)",
          "--font-sans": '"Host; Sans", system-ui, sans-serif',
        },
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const document = mountedIframe(element).srcdoc

  assert.match(document, /"theme":"dark"/)
  assert.match(
    document,
    /<style>:root \{\n  --color-background-primary: light-dark\(#ffffff, #171717\);\n  --font-sans: "Host; Sans", system-ui, sans-serif;\n\}<\/style>/,
  )
  assert.ok(document.indexOf("<style>") < document.indexOf("Object.defineProperty(window"))
  assert.ok(document.indexOf("<style>") < document.indexOf(content))
  instance.dispose()
})

void test("mount advertises and delivers configured host capabilities", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  let received: SendMessageParams | undefined
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    capabilities: {
      sendMessage: async (params) => {
        received = params
      },
      openLink: async () => undefined,
    },
    onEvent: (event) => events.push(event),
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  assert.match(iframe.srcdoc, /"sendMessage":true/)
  assert.match(iframe.srcdoc, /"openLink":true/)
  assert.match(iframe.srcdoc, /"updateModelContext":false/)

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: surface.id,
    callId: "capability-1",
    capability: "ui/message",
    params: {
      role: "user",
      content: { type: "text", text: "Show the selected orders" },
    },
  })
  await flushAsync()

  assert.deepEqual(received, {
    role: "user",
    content: { type: "text", text: "Show the selected orders" },
  })
  assert.deepEqual(
    hostMessages.find((message) => isRecord(message) && message.action === "ui/message"),
    {
      channel: protocolChannel,
      type: "result",
      surfaceId: surface.id,
      callId: "capability-1",
      action: "ui/message",
      result: { ok: true, value: {} },
    },
  )
  assert.deepEqual(
    events.filter(
      (event) => event.type === "capability_call" || event.type === "capability_result",
    ),
    [
      {
        type: "capability_call",
        call: {
          surfaceId: surface.id,
          callId: "capability-1",
          capability: "sendMessage",
        },
        payloadBytes: 24,
      },
      {
        type: "capability_result",
        callId: "capability-1",
        capability: "sendMessage",
        outcome: "ok",
      },
    ],
  )
  instance.dispose()
})

void test("mount rejects unknown keys and unsafe host style values before rendering", () => {
  const invalidVariables: Array<{
    readonly expected: RegExp
    readonly variables: Partial<Record<McpUiStyleVariableKey, string>>
  }> = []

  const unknownKey: Partial<Record<McpUiStyleVariableKey, string>> = {}
  Reflect.set(unknownKey, "--custom-accent", "rebeccapurple")
  invalidVariables.push({ variables: unknownKey, expected: /Unsupported MCP Apps style variable/ })

  for (const [value, expected] of [
    ["", /must be a non-empty string/],
    ["red\t", /control character/],
    ["red\u0085", /control character/],
    ["rgb(0 0 0) {}", /unsafe CSS/],
    ["red; --color-text-primary: blue", /top-level semicolon/],
  ] as const) {
    invalidVariables.push({
      variables: { "--color-background-primary": value },
      expected,
    })
  }

  const nonString: Partial<Record<McpUiStyleVariableKey, string>> = {}
  Reflect.set(nonString, "--color-background-primary", 42)
  invalidVariables.push({ variables: nonString, expected: /must be a non-empty string/ })

  for (const { variables, expected } of invalidVariables) {
    const { element } = createMountTarget()
    const hostContext: HostContext = { styles: { variables } }
    assert.throws(
      () =>
        mount(asDomElement(element), testSurface([]), {
          hostContext,
          transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
        }),
      expected,
    )
    assert.equal(element.childNodes.length, 0)
  }
})

void test("red team: mount rejects a host style value that closes the trusted style block", () => {
  const { element } = createMountTarget()
  const hostileValue = `red</style><script>window.compromised = true</script>`

  assert.throws(
    () =>
      mount(asDomElement(element), testSurface([]), {
        hostContext: {
          styles: { variables: { "--color-background-primary": hostileValue } },
        },
        transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
      }),
    /contains unsafe CSS/,
  )
  assert.equal(element.childNodes.length, 0)
})

void test("updateHostContext applies theme live and defers copied variables until replace", async () => {
  const { element } = createMountTarget()
  const first = testSurface([], `<p>First</p>`)
  const second = testSurface([], `<p>Second</p>`)
  const instance = mount(asDomElement(element), first, {
    hostContext: {
      theme: "light",
      styles: { variables: { "--color-text-primary": "#111111" } },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }
  const variables: Partial<Record<McpUiStyleVariableKey, string>> = {
    "--color-text-primary": "#222222",
  }

  instance.updateHostContext({ styles: { variables } })
  variables["--color-text-primary"] = "#333333"
  assert.deepEqual(hostMessages, [])
  assert.match(iframe.srcdoc, /--color-text-primary: #111111/)

  instance.updateHostContext({ theme: "dark" })
  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: first.id,
      theme: "dark",
    },
  ])

  await instance.replace(second)
  assert.match(iframe.srcdoc, /"theme":"dark"/)
  assert.match(iframe.srcdoc, /--color-text-primary: #222222/)
  assert.doesNotMatch(iframe.srcdoc, /--color-text-primary: #111111|#333333/)
  instance.dispose()
})

void test("mount replays the latest host theme after the sandbox bootstrap loads", () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    hostContext: { theme: "light" },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  instance.updateHostContext({ theme: "dark" })
  hostMessages.length = 0
  iframe.dispatchEvent(new window.Event("load"))

  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: surface.id,
      theme: "dark",
    },
  ])
  instance.dispose()
})

void test("updateHostContext rejects invalid updates without changing current context", async () => {
  const { element } = createMountTarget()
  const first = testSurface([])
  const second = testSurface([])
  const instance = mount(asDomElement(element), first, {
    hostContext: {
      theme: "light",
      styles: { variables: { "--color-text-primary": "#111111" } },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const invalidTheme: HostContext = {}
  Reflect.set(invalidTheme, "theme", "sepia")
  const hostileVariables: Partial<Record<McpUiStyleVariableKey, string>> = {
    "--color-text-primary": `red</style><script>window.compromised = true</script>`,
  }

  assert.throws(() => instance.updateHostContext(invalidTheme), /theme must be/)
  assert.throws(
    () => instance.updateHostContext({ styles: { variables: hostileVariables } }),
    /contains unsafe CSS/,
  )

  await instance.replace(second)
  const document = mountedIframe(element).srcdoc
  assert.match(document, /"theme":"light"/)
  assert.match(document, /--color-text-primary: #111111/)
  instance.dispose()
})

void test("mount embeds the grant and kills a self-navigating frame", () => {
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
  assert.match(iframe.srcdoc, /"actions":\[\{"name":"dice\.roll"/)

  iframe.dispatchEvent(new window.Event("load"))
  assert.deepEqual(hostMessages, [])
  iframe.dispatchEvent(new window.Event("load"))
  assert.equal(element.querySelector("iframe"), null)
  assert.equal(
    element.querySelector('[role="alert"]')?.textContent,
    "Generated UI navigation blocked.",
  )
  assert.deepEqual(events, [{ type: "violation", reason: "navigation" }])
  instance.dispose()
})

void test("updateHostContext is idempotently inert after dispose and termination", () => {
  for (const lifecycle of ["dispose", "terminate"] as const) {
    const { window, element } = createMountTarget()
    const surface = testSurface([])
    const instance = mount(asDomElement(element), surface, {
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })
    const iframe = mountedIframe(element)
    const hostMessages: unknown[] = []
    if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
    iframe.contentWindow.postMessage = (message: unknown): void => {
      hostMessages.push(message)
    }

    if (lifecycle === "dispose") {
      instance.dispose()
      instance.dispose()
    } else {
      iframe.dispatchEvent(new window.Event("load"))
      iframe.dispatchEvent(new window.Event("load"))
    }

    instance.updateHostContext({ theme: "dark" })
    instance.updateHostContext({ theme: "dark" })
    assert.deepEqual(hostMessages, [])
    instance.dispose()
  }
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

void test("mount reports malformed sandbox messages", () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })

  dispatchSandboxMessage(window, mountedIframe(element), {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    height: "too-tall",
  })

  assert.deepEqual(events, [{ type: "violation", reason: "bad_message" }])
  instance.dispose()
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

void test("mount snapshots and restores same-surface replacements", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([], `<p>First</p>`)
  const second = { ...first, content: `<p>Second</p>` }
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  const captured = instance.snapshot()
  const firstRequest = hostMessages.find((message) => message.type === "snapshot_request")
  assert.notEqual(firstRequest, undefined)
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: firstRequest?.requestId,
    ok: true,
    value: { count: 3 },
  })
  assert.deepEqual(await captured, { count: 3 })

  const replacement = instance.replace(second)
  await flushAsync()
  const requests = hostMessages.filter((message) => message.type === "snapshot_request")
  const secondRequest = requests[1]
  assert.notEqual(secondRequest, undefined)
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: secondRequest?.requestId,
    ok: true,
    value: { count: 4 },
  })
  await replacement

  assert.match(iframe.srcdoc, /"restore":\{"count":4\}/)
  assert.match(iframe.srcdoc, /<p>Second<\/p>/)
  instance.dispose()
})

void test("mount restores state across surface ids only when explicit", async () => {
  const { element } = createMountTarget()
  const first = testSurface([], `<p>First</p>`)
  const second = testSurface([], `<p>Second</p>`)
  const third = testSurface([], `<p>Third</p>`)
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)

  await instance.replace(second)
  assert.doesNotMatch(iframe.srcdoc, /"restore":/)

  await instance.replace(third, { snapshot: { selected: "ord-1001" } })
  assert.match(iframe.srcdoc, /"restore":\{"selected":"ord-1001"\}/)
  instance.dispose()
})

void test("mount resolves unavailable snapshots after the configured timeout", async () => {
  const { element } = createMountTarget()
  const surface = testSurface([])
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    snapshotTimeoutMs: 0,
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })

  assert.equal(await instance.snapshot(), undefined)
  assert.deepEqual(events, [
    {
      type: "violation",
      reason: "snapshot_timeout",
      detail: "Surface snapshot timed out after 0ms.",
    },
  ])
  instance.dispose()
})

void test("mount tears down gracefully and returns the final snapshot", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  const result = instance.teardown({ reason: "surface_replaced", timeoutMs: 100 })
  const request = hostMessages.find((message) => message.type === "teardown_request")
  assert.deepEqual(request, {
    channel: protocolChannel,
    type: "teardown_request",
    surfaceId: surface.id,
    requestId: "teardown-1",
    reason: "surface_replaced",
  })

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: true,
    value: { count: 4 },
  })

  assert.deepEqual(await result, { count: 4 })
  assert.equal(element.querySelector("iframe"), null)
})

void test("graceful teardown is one-shot and accepts an empty acknowledgment", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  const first = instance.teardown({ timeoutMs: 100 })
  const second = instance.teardown({ timeoutMs: 100 })
  assert.equal(first, second)
  const requests = hostMessages.filter((message) => message.type === "teardown_request")
  assert.equal(requests.length, 1)
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: requests[0]?.requestId,
    ok: true,
  })

  assert.equal(await first, undefined)
  assert.equal(element.querySelector("iframe"), null)
})

void test("graceful teardown times out, reports a violation, and disposes", async () => {
  const { element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), testSurface([]), {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })

  assert.equal(await instance.teardown({ timeoutMs: 0 }), undefined)
  assert.deepEqual(events, [
    {
      type: "violation",
      reason: "teardown_timeout",
      detail: "Surface teardown timed out after 0ms.",
    },
  ])
  assert.equal(element.querySelector("iframe"), null)
})

void test("graceful teardown rejects invalid options before posting a request", () => {
  const { element } = createMountTarget()
  const instance = mount(asDomElement(element), testSurface([]), {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  for (const options of [
    { reason: 42 },
    { reason: "x".repeat(257) },
    { timeoutMs: null },
    { timeoutMs: "soon" },
    { timeoutMs: -1 },
    { timeoutMs: Number.NaN },
    { timeoutMs: Number.POSITIVE_INFINITY },
  ]) {
    const teardown = Reflect.get(instance, "teardown")
    if (typeof teardown !== "function") throw new Error("Expected a teardown method.")
    assert.throws(() => Reflect.apply(teardown, instance, [options]), TypeError)
  }

  assert.deepEqual(hostMessages, [])
  instance.dispose()
})

void test("teardown makes replacement and host-context updates inert", async () => {
  const { window, element } = createMountTarget()
  const first = testSurface([], "<p>First</p>")
  const second = { ...first, content: "<p>Second</p>" }
  const third = testSurface([], "<p>Third</p>")
  const instance = mount(asDomElement(element), first, {
    hostContext: { theme: "light" },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  const replacement = instance.replace(second)
  await flushAsync()
  const snapshotRequest = hostMessages.find((message) => message.type === "snapshot_request")
  assert.notEqual(snapshotRequest, undefined)

  const teardown = instance.teardown({ timeoutMs: 100 })
  instance.updateHostContext({ theme: "dark" })
  const laterReplacement = instance.replace(third)
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: first.id,
    requestId: snapshotRequest?.requestId,
    ok: true,
    value: { count: 2 },
  })
  await Promise.all([replacement, laterReplacement])

  assert.equal(instance.surface, first)
  assert.match(iframe.srcdoc, /<p>First<\/p>/)
  assert.equal(
    hostMessages.some(
      (message) => message.type === "host_context_changed" && message.theme === "dark",
    ),
    false,
  )

  const teardownRequest = hostMessages.find((message) => message.type === "teardown_request")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: first.id,
    requestId: teardownRequest?.requestId,
    ok: false,
  })
  assert.equal(await teardown, undefined)
})

void test("teardown is inert after abrupt disposal or termination", async () => {
  for (const lifecycle of ["dispose", "terminate"] as const) {
    const { window, element } = createMountTarget()
    const instance = mount(asDomElement(element), testSurface([]), {
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })
    const iframe = mountedIframe(element)
    const hostMessages: unknown[] = []
    if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
    iframe.contentWindow.postMessage = (message: unknown): void => {
      hostMessages.push(message)
    }

    if (lifecycle === "dispose") {
      instance.dispose()
    } else {
      iframe.dispatchEvent(new window.Event("load"))
      iframe.dispatchEvent(new window.Event("load"))
    }

    const first = instance.teardown()
    const second = instance.teardown()
    assert.equal(first, second)
    assert.equal(await first, undefined)
    assert.equal(
      hostMessages.some((message) => isRecord(message) && message.type === "teardown_request"),
      false,
    )
    if (lifecycle === "terminate") {
      assert.equal(
        element.querySelector('[role="alert"]')?.textContent,
        "Generated UI navigation blocked.",
      )
    }
  }
})

void test("termination resolves a pending teardown without removing the violation", async () => {
  const { window, element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), testSurface([]), {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  const teardown = instance.teardown({ timeoutMs: 100 })
  iframe.dispatchEvent(new window.Event("load"))
  iframe.dispatchEvent(new window.Event("load"))

  assert.equal(await teardown, undefined)
  assert.equal(
    element.querySelector('[role="alert"]')?.textContent,
    "Generated UI navigation blocked.",
  )
  assert.deepEqual(events, [{ type: "violation", reason: "navigation" }])
})

void test("abrupt disposal resolves a pending teardown immediately", async () => {
  const { element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), testSurface([]), {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })

  const teardown = instance.teardown({ timeoutMs: 100 })
  instance.dispose()

  assert.equal(await teardown, undefined)
  assert.deepEqual(events, [])
  assert.equal(element.querySelector("iframe"), null)
})

void test("re-entrant disposal cannot erase an acknowledged final snapshot", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([diceDescriptor])
  const actionResult = deferred<ActionResult>()
  let mounted: ReturnType<typeof mount> | undefined
  mounted = mount(asDomElement(element), surface, {
    transport: async (_call, { signal }) => {
      signal.addEventListener(
        "abort",
        () => {
          mounted?.dispose()
        },
        { once: true },
      )
      return actionResult.promise
    },
  })
  const instance = mounted
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  dispatchSandboxMessage(window, iframe, sandboxActionMessage(surface))
  await flushAsync()
  const teardown = instance.teardown({ timeoutMs: 100 })
  const request = hostMessages.find((message) => message.type === "teardown_request")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: true,
    value: { saved: true },
  })

  assert.deepEqual(await teardown, { saved: true })
  actionResult.resolve({ ok: true, value: {} })
})

void test("red team: teardown acknowledgments require the trusted request identity", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }
  let settled = false
  const teardown = instance.teardown({ timeoutMs: 100 }).then((value) => {
    settled = true
    return value
  })
  const request = hostMessages.find((message) => message.type === "teardown_request")
  const acknowledgment = {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: true,
    value: { saved: true },
  }

  window.dispatchEvent(new window.MessageEvent("message", { data: acknowledgment, source: window }))
  dispatchSandboxMessage(window, iframe, { ...acknowledgment, requestId: "wrong-request" })
  dispatchSandboxMessage(window, iframe, { ...acknowledgment, surfaceId: "wrong-surface" })
  await flushAsync()
  assert.equal(settled, false)

  dispatchSandboxMessage(window, iframe, acknowledgment)
  assert.deepEqual(await teardown, { saved: true })
})

void test("red team: malformed and replayed teardown acknowledgments are ignored", async () => {
  const { window, element } = createMountTarget()
  const events: SurfaceEvent[] = []
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }
  const teardown = instance.teardown({ timeoutMs: 10 })
  const request = hostMessages.find((message) => message.type === "teardown_request")
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: true,
    value: cyclic,
  })
  assert.equal(await teardown, undefined)
  assert.deepEqual(events, [
    { type: "violation", reason: "bad_message" },
    {
      type: "violation",
      reason: "teardown_timeout",
      detail: "Surface teardown timed out after 10ms.",
    },
  ])

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: false,
  })
  assert.equal(await instance.teardown(), undefined)
  assert.equal(events.length, 2)
})

void test("teardown keeps guest work live until disposal and finishes pending snapshots", async () => {
  const { window, element } = createMountTarget()
  const calls: ActionCall[] = []
  const surface = testSurface([diceDescriptor])
  const instance = mount(asDomElement(element), surface, {
    transport: async (call): Promise<ActionResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }

  const snapshot = instance.snapshot()
  const teardown = instance.teardown({ timeoutMs: 100 })
  dispatchSandboxMessage(window, iframe, sandboxActionMessage(surface))
  await flushAsync()

  assert.equal(calls.length, 1)
  assert.equal(
    hostMessages.some((message) => message.type === "result" && message.action === "dice.roll"),
    true,
  )
  const teardownRequest = hostMessages.find((message) => message.type === "teardown_request")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: teardownRequest?.requestId,
    ok: false,
  })

  assert.equal(await teardown, undefined)
  assert.equal(await snapshot, undefined)
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

void test("red team: forged postMessage identities and sources are ignored", () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([diceDescriptor])
  const events: SurfaceEvent[] = []
  let transportCalled = false
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => {
      transportCalled = true
      return { ok: true, value: {} }
    },
    onEvent: (event) => events.push(event),
  })
  const iframe = mountedIframe(element)

  dispatchSandboxMessage(window, iframe, {
    ...sandboxActionMessage(surface),
    channel: "forged/channel",
  })
  dispatchSandboxMessage(window, iframe, {
    ...sandboxActionMessage(surface),
    surfaceId: "forged-surface",
  })
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: sandboxActionMessage(surface),
      source: window,
    }),
  )

  assert.equal(transportCalled, false)
  assert.deepEqual(events, [])
  instance.dispose()
})
