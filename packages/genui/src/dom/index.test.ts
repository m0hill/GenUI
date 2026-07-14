import assert from "node:assert/strict"
import { test } from "node:test"
import {
  subscriptionEventByteLimit,
  type ActionCall,
  type ActionResult,
} from "../protocol/index.js"
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
      containerDimensions: { width: 480, maxHeight: 720 },
      locale: "en-US",
      timeZone: "UTC",
      platform: "web",
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

  assert.match(
    document,
    /"hostContext":\{"theme":"dark","containerDimensions":\{"maxHeight":720,"width":480\},"locale":"en-US","timeZone":"UTC","platform":"web"\}/,
  )
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

  instance.updateHostContext({ styles: { variables }, locale: "fr-FR" })
  variables["--color-text-primary"] = "#333333"
  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: first.id,
      context: { locale: "fr-FR" },
    },
  ])
  assert.match(iframe.srcdoc, /--color-text-primary: #111111/)

  const omittedUpdate: HostContext = {}
  Reflect.set(omittedUpdate, "locale", undefined)
  instance.updateHostContext(omittedUpdate)
  assert.equal(hostMessages.length, 1)

  instance.updateHostContext({ theme: "dark" })
  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: first.id,
      context: { locale: "fr-FR" },
    },
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: first.id,
      context: { theme: "dark" },
    },
  ])

  await instance.replace(second)
  assert.match(iframe.srcdoc, /"theme":"dark"/)
  assert.match(iframe.srcdoc, /"locale":"fr-FR"/)
  assert.match(iframe.srcdoc, /--color-text-primary: #222222/)
  assert.doesNotMatch(iframe.srcdoc, /--color-text-primary: #111111|#333333/)
  instance.dispose()
})

void test("mount replays and replaces with the latest complete runtime context", async () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const instance = mount(asDomElement(element), surface, {
    hostContext: {
      theme: "light",
      containerDimensions: { maxHeight: 720 },
      locale: "en-US",
      timeZone: "UTC",
      platform: "web",
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  instance.updateHostContext({
    theme: "dark",
    containerDimensions: { width: 400, maxHeight: 600 },
    locale: "fr-FR",
    timeZone: "Europe/Paris",
    platform: "desktop",
  })
  hostMessages.length = 0
  iframe.dispatchEvent(new window.Event("load"))

  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: surface.id,
      context: {
        theme: "dark",
        containerDimensions: { maxHeight: 600, width: 400 },
        locale: "fr-FR",
        timeZone: "Europe/Paris",
        platform: "desktop",
      },
    },
  ])

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 900,
    height: 500,
  })
  assert.equal(iframe.style.height, "500px")

  const replacement = { ...surface, content: "<p>Same-surface replacement</p>" }
  await instance.replace(replacement, { snapshot: {} })
  assert.match(iframe.srcdoc, /"locale":"fr-FR"/)
  assert.match(iframe.srcdoc, /"timeZone":"Europe\/Paris"/)
  assert.match(iframe.srcdoc, /"platform":"desktop"/)
  assert.match(iframe.srcdoc, /"containerDimensions":\{"maxHeight":600,"width":400\}/)
  assert.equal(iframe.style.width, "400px")
  assert.equal(iframe.style.height, "")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: replacement.id,
    width: 900,
    height: 900,
  })
  assert.equal(iframe.style.width, "400px")
  assert.equal(iframe.style.height, "600px")
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
  const invalidDimensions: HostContext = { theme: "dark" }
  Reflect.set(invalidDimensions, "containerDimensions", { width: 400, maxWidth: 800 })
  assert.throws(
    () => instance.updateHostContext(invalidDimensions),
    /cannot contain width and maxWidth/,
  )
  const invalidLocale: HostContext = {}
  Reflect.set(invalidLocale, "locale", "not_a_locale")
  assert.throws(() => instance.updateHostContext(invalidLocale), /valid BCP-47 locale/)

  await instance.replace(second)
  const document = mountedIframe(element).srcdoc
  assert.match(document, /"theme":"light"/)
  assert.match(document, /--color-text-primary: #111111/)
  instance.dispose()
})

void test("mount omits action descriptors and kills a self-navigating frame", () => {
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
  assert.doesNotMatch(iframe.srcdoc, /"actions":/)
  assert.doesNotMatch(iframe.srcdoc, /dice\.roll/)

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
    const events: SurfaceEvent[] = []
    const instance = mount(asDomElement(element), surface, {
      ...(imagePolicy === undefined ? {} : { imagePolicy }),
      hostContext: { containerDimensions: { maxHeight: 320 } },
      onEvent: (event) => events.push(event),
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })
    const iframe = mountedIframe(element)
    Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 640 })
    assert.match(iframe.srcdoc, new RegExp(expected.replaceAll("'", "\\'")))

    dispatchSandboxMessage(window, iframe, {
      channel: protocolChannel,
      type: "resize",
      surfaceId: surface.id,
      width: 640,
      height: 999,
    })
    assert.equal(iframe.style.width, "100%")
    assert.equal(iframe.style.maxHeight, "320px")
    assert.equal(iframe.style.height, "320px")
    assert.deepEqual(events, [{ type: "resize", width: 640, height: 320 }])
    instance.dispose()
  }
})

void test("initial default width reports the iframe's effective width", (context) => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    onEvent: (event) => events.push(event),
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  context.after(() => instance.dispose())
  const iframe = mountedIframe(element)
  Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 480 })

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 100_000,
    height: 200,
  })

  assert.equal(iframe.style.width, "100%")
  assert.deepEqual(events, [{ type: "resize", width: 480, height: 200 }])
})

void test("mount applies fixed, flexible, and safe-default sizing independently", () => {
  const cases = [
    {
      dimensions: { width: 400, maxHeight: 500 },
      expectedWidth: "400px",
      expectedHeight: "500px",
      expectedMaxWidth: "",
      expectedMaxHeight: "500px",
      effectiveWidth: 400,
      event: { type: "resize", width: 400, height: 500 },
    },
    {
      dimensions: { maxWidth: 600, height: 300 },
      expectedWidth: "600px",
      expectedHeight: "300px",
      expectedMaxWidth: "600px",
      expectedMaxHeight: "",
      effectiveWidth: 600,
      event: { type: "resize", width: 600, height: 300 },
    },
    {
      dimensions: { width: 400, height: 300 },
      expectedWidth: "400px",
      expectedHeight: "300px",
      expectedMaxWidth: "",
      expectedMaxHeight: "",
      effectiveWidth: 400,
      event: { type: "resize", width: 400, height: 300 },
    },
    {
      dimensions: { maxWidth: 600, maxHeight: 500 },
      expectedWidth: "600px",
      expectedHeight: "500px",
      expectedMaxWidth: "600px",
      expectedMaxHeight: "500px",
      effectiveWidth: 600,
      event: { type: "resize", width: 600, height: 500 },
    },
    {
      dimensions: {},
      expectedWidth: "100%",
      expectedHeight: "1200px",
      expectedMaxWidth: "",
      expectedMaxHeight: "1200px",
      effectiveWidth: 480,
      event: { type: "resize", width: 480, height: 1_200 },
    },
    {
      dimensions: { maxWidth: 0, maxHeight: 0 },
      expectedWidth: "0px",
      expectedHeight: "0px",
      expectedMaxWidth: "0px",
      expectedMaxHeight: "0px",
      effectiveWidth: 0,
      event: { type: "resize", width: 0, height: 0 },
    },
  ] as const

  for (const sizing of cases) {
    const { window, element } = createMountTarget()
    const surface = testSurface([])
    const events: SurfaceEvent[] = []
    const instance = mount(asDomElement(element), surface, {
      hostContext: { containerDimensions: sizing.dimensions },
      onEvent: (event) => events.push(event),
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })
    const iframe = mountedIframe(element)
    Object.defineProperty(iframe, "clientWidth", {
      configurable: true,
      value: sizing.effectiveWidth,
    })

    assert.equal(iframe.style.maxWidth, sizing.expectedMaxWidth)
    assert.equal(iframe.style.maxHeight, sizing.expectedMaxHeight)

    dispatchSandboxMessage(window, iframe, {
      channel: protocolChannel,
      type: "resize",
      surfaceId: surface.id,
      width: 800.2,
      height: 1_400.2,
    })

    assert.equal(iframe.style.width, sizing.expectedWidth)
    assert.equal(iframe.style.height, sizing.expectedHeight)
    assert.deepEqual(events, [sizing.event])
    instance.dispose()
  }
})

void test("live container updates replace the axis policy before later resize reports", () => {
  const { window, element } = createMountTarget()
  const surface = testSurface([])
  const events: SurfaceEvent[] = []
  const instance = mount(asDomElement(element), surface, {
    hostContext: { containerDimensions: { width: 400, height: 300 } },
    onEvent: (event) => events.push(event),
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const iframe = mountedIframe(element)
  let effectiveWidth = 400
  Object.defineProperty(iframe, "clientWidth", {
    configurable: true,
    get: () => effectiveWidth,
  })
  const hostMessages: unknown[] = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    hostMessages.push(message)
  }

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 800,
    height: 900,
  })
  assert.equal(iframe.style.width, "400px")
  assert.equal(iframe.style.height, "300px")

  const dimensions = { maxWidth: 500, maxHeight: 600 }
  instance.updateHostContext({ containerDimensions: dimensions })
  effectiveWidth = 500
  dimensions.maxWidth = 700
  assert.equal(iframe.style.width, "100%")
  assert.equal(iframe.style.height, "600px")
  assert.equal(iframe.style.maxWidth, "500px")
  assert.equal(iframe.style.maxHeight, "600px")
  assert.deepEqual(hostMessages, [
    {
      channel: protocolChannel,
      type: "host_context_changed",
      surfaceId: surface.id,
      context: { containerDimensions: { maxHeight: 600, maxWidth: 500 } },
    },
  ])

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 500,
    height: 900,
  })
  assert.equal(iframe.style.width, "500px")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 400,
    height: 900,
  })
  assert.equal(iframe.style.width, "500px")

  instance.updateHostContext({
    containerDimensions: { maxWidth: 700, maxHeight: 600 },
  })
  effectiveWidth = 700
  assert.equal(iframe.style.width, "100%")
  assert.equal(iframe.style.maxWidth, "700px")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 500,
    height: 900,
  })
  assert.equal(iframe.style.width, "700px")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 700,
    height: 900,
  })
  assert.equal(iframe.style.width, "700px")

  instance.updateHostContext({ containerDimensions: {} })
  assert.equal(iframe.style.width, "100%")
  assert.equal(iframe.style.height, "900px")
  assert.equal(iframe.style.maxWidth, "")
  assert.equal(iframe.style.maxHeight, "1200px")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "resize",
    surfaceId: surface.id,
    width: 700,
    height: 1_500,
  })
  assert.equal(iframe.style.width, "100%")
  assert.equal(iframe.style.height, "1200px")
  assert.deepEqual(events.at(-1), { type: "resize", width: 700, height: 1_200 })
  instance.dispose()
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
    width: 100,
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

void test("mount isolates subscriptions by document and aborts them on same-surface replacement", async () => {
  const { window, element } = createMountTarget()
  const base = testSurface([])
  const first = {
    ...base,
    grant: {
      ...base.grant,
      subscriptions: [
        {
          name: "orders.changes",
          description: "Receive order changes.",
          confidentiality: "normal" as const,
          maxEventBytes: subscriptionEventByteLimit,
        },
      ],
    },
  }
  const second = { ...first, content: "<p>Replacement</p>" }
  const signals: AbortSignal[] = []
  let returns = 0
  const never = deferred<IteratorResult<unknown>>()
  const instance = mount(asDomElement(element), first, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    subscriptionTransport: async (_request, options) => {
      signals.push(options.signal)
      return {
        events: {
          [Symbol.asyncIterator]() {
            return {
              next: () => never.promise,
              async return() {
                returns += 1
                return { done: true, value: undefined }
              },
            }
          },
        },
      }
    },
  })
  const iframe = mountedIframe(element)
  const initialDocumentId = /"documentId":"([^"]+)"/.exec(iframe.srcdoc)?.[1]
  assert.notEqual(initialDocumentId, undefined)

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "subscription_start",
    surfaceId: first.id,
    documentId: initialDocumentId,
    subscriptionId: `${initialDocumentId}:subscription-old`,
    subscription: "orders.changes",
    input: {},
  })
  await flushAsync()
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.aborted, false)

  await instance.replace(second, { snapshot: {} })
  assert.equal(signals[0]?.aborted, true)
  assert.equal(returns, 1)
  const replacementDocumentId = /"documentId":"([^"]+)"/.exec(iframe.srcdoc)?.[1]
  assert.notEqual(replacementDocumentId, initialDocumentId)

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "subscription_start",
    surfaceId: second.id,
    documentId: initialDocumentId,
    subscriptionId: `${initialDocumentId}:subscription-stale`,
    subscription: "orders.changes",
    input: {},
  })
  await flushAsync()
  assert.equal(signals.length, 1)

  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "subscription_start",
    surfaceId: second.id,
    documentId: replacementDocumentId,
    subscriptionId: `${replacementDocumentId}:subscription-current`,
    subscription: "orders.changes",
    input: {},
  })
  await flushAsync()
  assert.equal(signals.length, 2)
  instance.dispose()
  assert.equal(signals[1]?.aborted, true)
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
  instance.updateHostContext({
    containerDimensions: { width: 10, height: 10 },
    locale: "fr-FR",
  })
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
  assert.equal(iframe.style.width, "100%")
  assert.equal(iframe.style.height, "")
  assert.equal(
    hostMessages.some(
      (message) =>
        message.type === "host_context_changed" &&
        isRecord(message.context) &&
        message.context.theme === "dark",
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

void test("graceful teardown keeps subscriptions live until final disposal", async () => {
  const { window, element } = createMountTarget()
  const base = testSurface([])
  const surface = {
    ...base,
    grant: {
      ...base.grant,
      subscriptions: [
        {
          name: "orders.changes",
          description: "Receive order changes.",
          confidentiality: "normal" as const,
          maxEventBytes: subscriptionEventByteLimit,
        },
      ],
    },
  }
  const pending = deferred<IteratorResult<unknown>>()
  let signal: AbortSignal | undefined
  const instance = mount(asDomElement(element), surface, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    subscriptionTransport: async (_request, options) => {
      signal = options.signal
      return { events: { [Symbol.asyncIterator]: () => ({ next: () => pending.promise }) } }
    },
  })
  const iframe = mountedIframe(element)
  const hostMessages: Array<Readonly<Record<string, unknown>>> = []
  if (iframe.contentWindow === null) throw new Error("Expected an iframe content window.")
  iframe.contentWindow.postMessage = (message: unknown): void => {
    if (isRecord(message)) hostMessages.push(message)
  }
  const documentId = /"documentId":"([^"]+)"/.exec(iframe.srcdoc)?.[1]
  if (documentId === undefined) throw new Error("Missing document ID.")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "subscription_start",
    surfaceId: surface.id,
    documentId,
    subscriptionId: `${documentId}:subscription-live`,
    subscription: "orders.changes",
    input: {},
  })
  await flushAsync()
  assert.equal(signal?.aborted, false)

  const teardown = instance.teardown({ timeoutMs: 100 })
  assert.equal(signal?.aborted, false)
  const request = hostMessages.find((message) => message.type === "teardown_request")
  dispatchSandboxMessage(window, iframe, {
    channel: protocolChannel,
    type: "teardown",
    surfaceId: surface.id,
    requestId: request?.requestId,
    ok: true,
  })
  assert.equal(await teardown, undefined)
  assert.equal(signal?.aborted, true)
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
