import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createSandboxWindow,
  deferred,
  flushAsync,
  isRecord,
  jsonRoundTrip,
} from "../dom/test-support.test-support.js"
import type { Action } from "../protocol/index.js"
import { codeBootstrapScript } from "./bootstrap.js"

const channel = "genui/dom/0"
const surfaceId = "surface-code"

interface GuestApi {
  readonly surfaceId: string
  readonly actions: readonly unknown[]
  readonly capabilities: {
    readonly sendMessage: boolean
    readonly openLink: boolean
    readonly updateModelContext: boolean
  }
  call(name: string, input: unknown): Promise<unknown>
  sendMessage(text: unknown): Promise<void>
  openLink(url: unknown): Promise<void>
  updateModelContext(params: unknown): Promise<void>
  snapshot(provider: (restored?: unknown) => unknown): void
  teardown(handler: (context: { readonly reason?: string }) => unknown): void
}

interface HarnessOptions {
  readonly actions?: readonly Action[]
  readonly sendMessage?: boolean
  readonly openLink?: boolean
  readonly updateModelContext?: boolean
  readonly restore?: unknown
  readonly theme?: "light" | "dark"
}

interface CapturedInterval {
  readonly delayMs: number | undefined
  run(): void
  wasCleared(): boolean
}

type SandboxWindow = ReturnType<typeof createSandboxWindow>["window"]

const dispatchInboundMessage = (
  window: SandboxWindow,
  data: unknown,
  source: "parent" | "self" | "forged" = "parent",
): void => {
  const dataKey = "__genuiTestInboundMessage"
  const sourceExpression =
    source === "parent" ? "window.parent" : source === "self" ? "window" : "null"
  Reflect.set(window, dataKey, data)
  try {
    window.eval(`window.dispatchEvent(new MessageEvent("message", {
      data: window.${dataKey},
      source: ${sourceExpression}
    }))`)
  } finally {
    Reflect.deleteProperty(window, dataKey)
  }
}

const createHarness = (
  options: HarnessOptions = {},
): ReturnType<typeof createSandboxWindow> & {
  readonly genui: GuestApi
  readonly interval: CapturedInterval
} => {
  const harness = createSandboxWindow("")
  Object.defineProperty(harness.window, "parent", {
    configurable: true,
    value: {
      postMessage: (message: unknown): void => {
        harness.messages.push(message)
      },
    },
  })
  let intervalCallback: (() => void) | undefined
  let intervalDelayMs: number | undefined
  let intervalCleared = false
  Reflect.set(harness.window, "setInterval", (callback: unknown, delayMs: unknown): number => {
    if (typeof callback !== "function" || typeof delayMs !== "number") {
      throw new TypeError("Expected a function interval callback and numeric delay.")
    }
    intervalCallback = () => Reflect.apply(callback, harness.window, [])
    intervalDelayMs = delayMs
    return 1
  })
  Reflect.set(harness.window, "clearInterval", (intervalId: unknown): void => {
    if (intervalId === 1) intervalCleared = true
  })
  harness.window.eval(
    codeBootstrapScript({
      channel,
      surfaceId,
      actions: options.actions ?? [],
      sendMessage: options.sendMessage ?? false,
      openLink: options.openLink ?? false,
      updateModelContext: options.updateModelContext ?? false,
      ...(options.restore === undefined ? {} : { restore: options.restore }),
      ...(options.theme === undefined ? {} : { theme: options.theme }),
    }),
  )
  const genui = Reflect.get(harness.window, "genui")
  if (!isRecord(genui) || typeof genui.call !== "function") {
    throw new Error("Expected the code guest API.")
  }

  return {
    ...harness,
    // SAFETY: the generated bootstrap installed the pinned guest API in this isolated window.
    genui: genui as unknown as GuestApi,
    interval: {
      get delayMs() {
        return intervalDelayMs
      },
      run() {
        if (intervalCallback === undefined) throw new Error("Expected a captured interval.")
        intervalCallback()
      },
      wasCleared: () => intervalCleared,
    },
  }
}

const assertGenuiError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isRecord(error))
    assert.equal(error.name, "GenuiActionError")
    assert.equal(error.code, code)
    return true
  })
}

void test("code bootstrap installs the pinned API with its embedded grant", () => {
  const actions = [
    {
      name: "orders.search",
      description: "Search orders.",
      effect: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
      },
    },
  ] satisfies readonly Action[]
  const { genui } = createHarness({ actions })

  assert.equal(genui.surfaceId, surfaceId)
  assert.deepEqual(jsonRoundTrip(genui.actions), actions)
})

void test("code bootstrap exposes frozen host capability flags and methods", () => {
  const { genui } = createHarness({ sendMessage: true, updateModelContext: true })

  assert.deepEqual(jsonRoundTrip(genui.capabilities), {
    sendMessage: true,
    openLink: false,
    updateModelContext: true,
  })
  assert.equal(Object.isFrozen(genui.capabilities), true)
  assert.equal(typeof genui.sendMessage, "function")
  assert.equal(typeof genui.openLink, "function")
  assert.equal(typeof genui.updateModelContext, "function")
})

void test("code bootstrap awaits teardown cleanup before capturing final state", async () => {
  const { genui, messages, window } = createHarness()
  const gate = deferred<void>()
  let state = { count: 1 }
  let receivedReason: string | undefined
  genui.snapshot(() => state)
  genui.teardown(async ({ reason }) => {
    receivedReason = reason
    await gate.promise
    state = { count: 2 }
  })

  dispatchInboundMessage(window, {
    channel,
    type: "teardown_request",
    surfaceId,
    requestId: "teardown-1",
    reason: "surface_replaced",
  })
  await Promise.resolve()
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "teardown"),
    false,
  )

  gate.resolve(undefined)
  await flushAsync()
  assert.equal(receivedReason, "surface_replaced")
  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "teardown")),
    {
      channel,
      surfaceId,
      type: "teardown",
      requestId: "teardown-1",
      ok: true,
      value: { count: 2 },
    },
  )
})

void test("code bootstrap acknowledges teardown without a handler or snapshot provider", async () => {
  const { messages, window } = createHarness()

  dispatchInboundMessage(window, {
    channel,
    type: "teardown_request",
    surfaceId,
    requestId: "teardown-empty",
  })
  await flushAsync()

  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "teardown")),
    {
      channel,
      surfaceId,
      type: "teardown",
      requestId: "teardown-empty",
      ok: true,
    },
  )
})

void test("code bootstrap reports teardown failures and still acknowledges", async () => {
  const { genui, messages, window } = createHarness()
  genui.snapshot(() => ({ saved: true }))
  genui.teardown(() => {
    throw new Error("Cleanup failed")
  })

  dispatchInboundMessage(window, {
    channel,
    type: "teardown_request",
    surfaceId,
    requestId: "teardown-failed",
  })
  await flushAsync()

  const guestError = messages.find((message) => isRecord(message) && message.type === "guest_error")
  assert.ok(isRecord(guestError))
  assert.equal(guestError.message, "Cleanup failed")
  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "teardown")),
    {
      channel,
      surfaceId,
      type: "teardown",
      requestId: "teardown-failed",
      ok: false,
    },
  )
})

void test("code bootstrap validates teardown registration and host requests", async () => {
  const { genui, messages, window } = createHarness()
  const teardown = Reflect.get(genui, "teardown")
  if (typeof teardown !== "function") throw new Error("Expected a teardown method.")
  assert.throws(
    () => Reflect.apply(teardown, genui, [undefined]),
    /Teardown handler must be a function/,
  )
  let handlerCalls = 0
  genui.teardown(() => {
    handlerCalls += 1
  })
  const request = {
    channel,
    type: "teardown_request",
    surfaceId,
    requestId: "teardown-valid",
  }

  dispatchInboundMessage(window, request, "self")
  dispatchInboundMessage(window, { ...request, channel: "forged/channel" })
  dispatchInboundMessage(window, { ...request, surfaceId: "forged-surface" })
  dispatchInboundMessage(window, { ...request, requestId: "x".repeat(257) })
  dispatchInboundMessage(window, { ...request, reason: "x".repeat(257) })
  await flushAsync()

  assert.equal(handlerCalls, 0)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "teardown"),
    false,
  )
})

void test("code bootstrap captures teardown request identity and handler at receipt", async () => {
  const { genui, messages, window } = createHarness()
  let handler = "none"
  let receivedReason: string | undefined
  genui.snapshot(() => ({ saved: true }))
  genui.teardown(({ reason }) => {
    handler = "original"
    receivedReason = reason
  })
  const request = {
    channel,
    type: "teardown_request",
    surfaceId,
    requestId: "teardown-original",
    reason: "host_closed",
  }

  dispatchInboundMessage(window, request)
  request.requestId = "teardown-mutated"
  request.reason = "mutated"
  genui.teardown(() => {
    handler = "replacement"
  })
  await flushAsync()

  assert.equal(handler, "original")
  assert.equal(receivedReason, "host_closed")
  const acknowledgment = messages.find(
    (message) => isRecord(message) && message.type === "teardown",
  )
  assert.ok(isRecord(acknowledgment))
  assert.equal(acknowledgment.requestId, "teardown-original")
})

void test("code bootstrap rejects unavailable host capabilities locally", async () => {
  const { genui, messages } = createHarness()

  await Promise.all([
    assertGenuiError(genui.sendMessage("Hello"), "not_available"),
    assertGenuiError(genui.openLink("https://example.com"), "not_available"),
    assertGenuiError(genui.updateModelContext({ content: "Hello" }), "not_available"),
  ])
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability_call"),
    false,
  )
})

void test("code bootstrap rejects malformed capability input locally", async () => {
  const cases = [
    (genui: GuestApi) => genui.sendMessage(42),
    (genui: GuestApi) => genui.openLink(null),
    (genui: GuestApi) => genui.updateModelContext(null),
    (genui: GuestApi) => genui.updateModelContext({ content: 42 }),
    (genui: GuestApi) => genui.updateModelContext({ structuredContent: [] }),
    (genui: GuestApi) => genui.updateModelContext({ structuredContent: new Date(0) }),
    (genui: GuestApi) =>
      genui.updateModelContext({ structuredContent: { toJSON: () => ["not", "a", "record"] } }),
    (genui: GuestApi) => genui.updateModelContext({ unexpected: true }),
  ]

  for (const run of cases) {
    const { genui, messages } = createHarness({
      sendMessage: true,
      openLink: true,
      updateModelContext: true,
    })
    const result = run(genui)
    assert.equal(
      messages.some((message) => isRecord(message) && message.type === "capability_call"),
      false,
    )
    await assertGenuiError(result, "invalid_input")
  }
})

void test("code bootstrap turns hostile model-context accessors into promise rejections", async () => {
  const { genui, messages } = createHarness({ updateModelContext: true })
  const params = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("Hostile ownKeys trap")
      },
    },
  )

  let result: Promise<void> | undefined
  assert.doesNotThrow(() => {
    result = genui.updateModelContext(params)
  })
  assert.notEqual(result, undefined)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability_call"),
    false,
  )
  const captured = result
  if (captured === undefined) throw new Error("Expected a capability promise.")
  await assertGenuiError(captured, "invalid_input")
})

void test("code bootstrap enforces the 16 KiB send-message text limit in UTF-8 bytes", async () => {
  const exactText = "é".repeat(8 * 1_024)
  const exact = createHarness({ sendMessage: true })
  const exactResult = exact.genui.sendMessage(exactText)
  const request = exact.messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  dispatchInboundMessage(exact.window, {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: {} },
  })
  await exactResult

  const oversized = createHarness({ sendMessage: true })
  const oversizedResult = oversized.genui.sendMessage(`${exactText}a`)
  assert.equal(
    oversized.messages.some((message) => isRecord(message) && message.type === "capability_call"),
    false,
  )
  await assertGenuiError(oversizedResult, "invalid_input")
})

void test("code bootstrap enforces serialized model-context input and its 16 KiB limit", async () => {
  const maxBytes = 16 * 1_024
  const emptyPayloadBytes = new TextEncoder().encode(JSON.stringify({ content: "" })).byteLength
  const exactParams = { content: "x".repeat(maxBytes - emptyPayloadBytes) }
  const exact = createHarness({ updateModelContext: true })
  const exactResult = exact.genui.updateModelContext(exactParams)
  const request = exact.messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  dispatchInboundMessage(exact.window, {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: {} },
  })
  await exactResult

  const oversized = createHarness({ updateModelContext: true })
  const oversizedResult = oversized.genui.updateModelContext({
    content: `${exactParams.content}a`,
  })
  assert.equal(
    oversized.messages.some((message) => isRecord(message) && message.type === "capability_call"),
    false,
  )
  await assertGenuiError(oversizedResult, "invalid_input")

  const cyclic = createHarness({ updateModelContext: true })
  const structuredContent: Record<string, unknown> = {}
  structuredContent.self = structuredContent
  const cyclicResult = cyclic.genui.updateModelContext({ structuredContent })
  assert.equal(
    cyclic.messages.some((message) => isRecord(message) && message.type === "capability_call"),
    false,
  )
  await assertGenuiError(cyclicResult, "invalid_input")
})

void test("code bootstrap sends messages through the capability bridge and resolves void", async () => {
  const { genui, messages, window } = createHarness({ sendMessage: true })

  const result = genui.sendMessage("Show the selected orders")
  const request = messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  assert.deepEqual(jsonRoundTrip(request), {
    channel,
    surfaceId,
    type: "capability_call",
    callId: request.callId,
    capability: "ui/message",
    params: {
      role: "user",
      content: { type: "text", text: "Show the selected orders" },
    },
  })

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: { ignored: "host return value" } },
  })
  assert.equal(await result, undefined)
})

void test("code bootstrap sends open-link requests through the capability bridge", async () => {
  const { genui, messages, window } = createHarness({ openLink: true })

  const result = genui.openLink("https://example.com/orders/42")
  const request = messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  assert.deepEqual(jsonRoundTrip(request), {
    channel,
    surfaceId,
    type: "capability_call",
    callId: request.callId,
    capability: "ui/open-link",
    params: { url: "https://example.com/orders/42" },
  })

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: {} },
  })
  await result
})

void test("code bootstrap sends model-context updates through the capability bridge", async () => {
  const { genui, messages, window } = createHarness({ updateModelContext: true })
  const params = {
    content: "The user selected two orders.",
    structuredContent: { selectedOrderIds: ["order-2", "order-5"] },
  }

  const result = genui.updateModelContext(params)
  const request = messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  assert.deepEqual(jsonRoundTrip(request), {
    channel,
    surfaceId,
    type: "capability_call",
    callId: request.callId,
    capability: "ui/update-model-context",
    params,
  })

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: {} },
  })
  await result
})

void test("code bootstrap preserves host capability error codes", async () => {
  for (const code of ["denied", "invalid_input", "rate_limited"]) {
    const { genui, messages, window } = createHarness({ openLink: true })
    const result = genui.openLink("https://example.com")
    const request = messages.find(
      (message) => isRecord(message) && message.type === "capability_call",
    )
    assert.ok(isRecord(request))

    dispatchInboundMessage(window, {
      channel,
      type: "result",
      surfaceId,
      callId: request.callId,
      result: { ok: false, error: { code, message: "Host rejected the request." } },
    })

    await assertGenuiError(result, code)
  }
})

void test("red team: guest-posted capability results cannot settle pending requests", async () => {
  const { genui, messages, window } = createHarness({ sendMessage: true })
  let settled = false
  const result = genui.sendMessage("Hello").then(() => {
    settled = true
  })
  const request = messages.find(
    (message) => isRecord(message) && message.type === "capability_call",
  )
  assert.ok(isRecord(request))
  const response = {
    channel,
    type: "result",
    surfaceId,
    callId: request.callId,
    result: { ok: true, value: {} },
  }

  dispatchInboundMessage(window, response, "self")
  await Promise.resolve()
  assert.equal(settled, false)

  dispatchInboundMessage(window, response)
  await result
  assert.equal(settled, true)
})

void test("code bootstrap applies the initial document theme", () => {
  const { window } = createHarness({ theme: "dark" })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark")
  assert.equal(window.document.documentElement.style.colorScheme, "dark")
})

void test("code bootstrap applies live host theme changes", () => {
  const { window } = createHarness({ theme: "light" })

  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    theme: "dark",
  })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark")
  assert.equal(window.document.documentElement.style.colorScheme, "dark")
})

void test("red team: code bootstrap ignores forged and invalid host theme changes", () => {
  const { window } = createHarness({ theme: "light" })
  const update = {
    channel,
    type: "host_context_changed",
    surfaceId,
    theme: "dark",
  }

  dispatchInboundMessage(window, update, "forged")
  dispatchInboundMessage(window, { ...update, channel: "forged/channel" })
  dispatchInboundMessage(window, { ...update, surfaceId: "forged-surface" })
  dispatchInboundMessage(window, { ...update, theme: "sepia" })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "light")
  assert.equal(window.document.documentElement.style.colorScheme, "light")
})

void test("code bootstrap posts a heartbeat every second until pagehide", () => {
  const { interval, messages, window } = createHarness()
  const heartbeats = () =>
    messages.filter((message) => isRecord(message) && message.type === "heartbeat")

  assert.equal(interval.delayMs, 1_000)
  assert.equal(heartbeats().length, 1)

  interval.run()
  assert.equal(heartbeats().length, 2)

  window.dispatchEvent(new window.Event("pagehide"))
  assert.equal(interval.wasCleared(), true)
})

void test("red team: unknown, replayed, and duplicate results are ignored", async () => {
  const { genui, messages, window } = createHarness()
  let settled = false
  const result = genui.call("orders.search", { status: "open" }).then((value) => {
    settled = true
    return value
  })
  const call = messages.find((message) => isRecord(message) && typeof message.callId === "string")
  assert.ok(isRecord(call))
  assert.deepEqual(jsonRoundTrip(call), {
    channel,
    surfaceId,
    callId: call.callId,
    action: "orders.search",
    input: { status: "open" },
  })

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: "unknown-call",
    result: { ok: true, value: "wrong" },
  })
  await Promise.resolve()
  assert.equal(settled, false)

  const response = {
    channel,
    type: "result",
    surfaceId,
    callId: call.callId,
    result: { ok: true, value: [{ id: "order-1" }] },
  }
  dispatchInboundMessage(window, response)
  assert.deepEqual(jsonRoundTrip(await result), [{ id: "order-1" }])

  let secondSettled = false
  const secondResult = genui.call("orders.search", { status: "shipped" }).then((value) => {
    secondSettled = true
    return value
  })
  const calls = messages.filter(
    (message) => isRecord(message) && typeof message.callId === "string",
  )
  const secondCall = calls[1]
  assert.ok(isRecord(secondCall))

  dispatchInboundMessage(window, response)
  await Promise.resolve()
  assert.equal(secondSettled, false)

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: secondCall.callId,
    result: { ok: true, value: [{ id: "order-2" }] },
  })
  assert.deepEqual(jsonRoundTrip(await secondResult), [{ id: "order-2" }])
})

void test("code bootstrap rejects failed calls with GenuiActionError", async () => {
  const { genui, messages, window } = createHarness()
  const result = genui.call("orders.update_status", { id: "order-1", status: "shipped" })
  const call = messages.find((message) => isRecord(message) && typeof message.callId === "string")
  assert.ok(isRecord(call))

  dispatchInboundMessage(window, {
    channel,
    type: "result",
    surfaceId,
    callId: call.callId,
    result: {
      ok: false,
      error: { code: "approval_denied", message: "Action was denied." },
    },
  })

  await assert.rejects(result, (error: unknown) => {
    assert.ok(isRecord(error))
    assert.equal(error.name, "GenuiActionError")
    assert.equal(error.code, "approval_denied")
    assert.equal(error.message, "Action was denied.")
    return true
  })
})

void test("code bootstrap reports guest errors and unhandled rejections", () => {
  const { messages, window } = createHarness()
  const onerror = Reflect.get(window, "onerror")
  if (typeof onerror !== "function") throw new Error("Expected a window.onerror handler.")
  Reflect.apply(onerror, window, ["Synchronous boom", "", 0, 0, { stack: "sync stack" }])

  const rejection = new window.Event("unhandledrejection")
  Object.defineProperty(rejection, "reason", {
    value: { message: "Asynchronous boom", stack: "async stack" },
  })
  window.dispatchEvent(rejection)

  assert.deepEqual(
    messages
      .filter((message) => isRecord(message) && message.type === "guest_error")
      .map(jsonRoundTrip),
    [
      {
        channel,
        surfaceId,
        type: "guest_error",
        message: "Synchronous boom",
        stack: "sync stack",
      },
      {
        channel,
        surfaceId,
        type: "guest_error",
        message: "Asynchronous boom",
        stack: "async stack",
      },
    ],
  )
})

void test("code bootstrap restores and captures registered guest state", async () => {
  const { genui, messages, window } = createHarness({ restore: { count: 2 } })
  let state = { count: 0 }
  genui.snapshot((restored) => {
    if (isRecord(restored) && typeof restored.count === "number") {
      state = { count: restored.count }
    }
    return state
  })
  assert.deepEqual(state, { count: 2 })

  state = { count: 3 }
  dispatchInboundMessage(window, {
    channel,
    type: "snapshot_request",
    surfaceId,
    requestId: "snapshot-1",
  })
  await flushAsync()

  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "snapshot")),
    {
      channel,
      surfaceId,
      type: "snapshot",
      requestId: "snapshot-1",
      ok: true,
      value: { count: 3 },
    },
  )
})

void test("code bootstrap reports snapshot provider failures", async () => {
  const { genui, messages, window } = createHarness()
  genui.snapshot(() => {
    throw new Error("Snapshot failed")
  })
  dispatchInboundMessage(window, {
    channel,
    type: "snapshot_request",
    surfaceId,
    requestId: "snapshot-failed",
  })
  await flushAsync()

  const guestError = messages.find((message) => isRecord(message) && message.type === "guest_error")
  assert.ok(isRecord(guestError))
  assert.equal(guestError.message, "Snapshot failed")
  assert.equal(typeof guestError.stack, "string")
  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "snapshot")),
    {
      channel,
      surfaceId,
      type: "snapshot",
      requestId: "snapshot-failed",
      ok: false,
    },
  )
})

void test("red team: code bootstrap ignores messages not sent by its parent", async () => {
  const { genui, messages, window } = createHarness()
  let settled = false
  const result = genui.call("orders.search", {}).then((value) => {
    settled = true
    return value
  })
  const call = messages.find((message) => isRecord(message) && typeof message.callId === "string")
  assert.ok(isRecord(call))
  const response = {
    channel,
    type: "result",
    surfaceId,
    callId: call.callId,
    result: { ok: true, value: "trusted" },
  }

  dispatchInboundMessage(window, response, "forged")
  await Promise.resolve()
  assert.equal(settled, false)

  dispatchInboundMessage(window, response)
  assert.equal(await result, "trusted")
})
