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
