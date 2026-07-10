import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createSandboxWindow,
  deferred,
  flushAsync,
  isRecord,
  jsonRoundTrip,
} from "../dom/test-support.test-support.js"
import { createSubscriptionBroker, SubscriptionTransportError } from "../dom/subscription-broker.js"
import { parseSandboxMessage } from "../dom/sandbox-message-schema.js"
import type { GuestHostContext } from "../host-context.js"
import {
  codeDialect,
  subscriptionEventByteLimit,
  type Action,
  type Subscription,
  type Surface,
} from "../protocol/index.js"
import { codeBootstrapScript } from "./bootstrap.js"

const channel = "genui/dom/0"
const surfaceId = "surface-code"

interface GuestApi {
  readonly surfaceId: string
  readonly actions: readonly unknown[]
  readonly subscriptions: readonly Subscription[]
  readonly capabilities: {
    readonly sendMessage: boolean
    readonly openLink: boolean
    readonly updateModelContext: boolean
  }
  readonly hostContext: GuestHostContext
  call(name: string, input: unknown): Promise<unknown>
  sendMessage(text: unknown): Promise<void>
  openLink(url: unknown): Promise<void>
  updateModelContext(params: unknown): Promise<void>
  snapshot(provider: (restored?: unknown) => unknown): void
  teardown(handler: (context: { readonly reason?: string }) => unknown): void
  onHostContextChange(handler: (partial: GuestApi["hostContext"]) => unknown): void
  subscribe(
    subscription: string,
    input: unknown,
    handler: (event: unknown) => unknown,
  ): Promise<{
    readonly unsubscribe: () => Promise<void>
    readonly done: Promise<
      | { readonly ok: true; readonly reason: "completed" | "unsubscribed" }
      | {
          readonly ok: false
          readonly error: { readonly code: string; readonly message: string }
        }
    >
  }>
}

interface HarnessOptions {
  readonly documentId?: string
  readonly actions?: readonly Action[]
  readonly subscriptions?: readonly Subscription[]
  readonly sendMessage?: boolean
  readonly openLink?: boolean
  readonly updateModelContext?: boolean
  readonly restore?: unknown
  readonly hostContext?: GuestApi["hostContext"]
}

interface CapturedInterval {
  readonly delayMs: number | undefined
  run(): void
  wasCleared(): boolean
}

interface CapturedResizeObserver {
  readonly observedTargets: readonly Element[]
  notify(): void
  runAnimationFrame(): void
  wasDisconnected(): boolean
  wasAnimationFrameCanceled(): boolean
}

type SandboxWindow = ReturnType<typeof createSandboxWindow>["window"]
const trustedMessageHandlerKey = "__genuiTestTrustedMessageHandler"

const dispatchInboundMessage = (
  window: SandboxWindow,
  data: unknown,
  source: "parent" | "self" | "forged" = "parent",
): void => {
  const handler = Reflect.get(window, trustedMessageHandlerKey)
  if (typeof handler !== "function") throw new Error("Expected a captured message handler.")
  const eventSource =
    source === "parent" ? Reflect.get(window, "parent") : source === "self" ? window : null
  Reflect.apply(handler, window, [{ data, source: eventSource, isTrusted: true }])
}

const dispatchSyntheticInboundMessage = (window: SandboxWindow, data: unknown): void => {
  const dataKey = "__genuiTestInboundMessage"
  Reflect.set(window, dataKey, data)
  try {
    window.eval(`window.dispatchEvent(new MessageEvent("message", {
      data: window.${dataKey},
      source: window.parent
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
  readonly resizeObserver: CapturedResizeObserver
} => {
  const harness = createSandboxWindow("")
  const addEventListener = harness.window.addEventListener.bind(harness.window)
  Reflect.set(
    harness.window,
    "addEventListener",
    (type: unknown, listener: unknown, options: unknown): void => {
      if (type === "message" && typeof listener === "function") {
        Reflect.set(harness.window, trustedMessageHandlerKey, listener)
      }
      Reflect.apply(addEventListener, harness.window, [type, listener, options])
    },
  )
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
  let resizeCallback: (() => void) | undefined
  let animationFrameCallback: (() => void) | undefined
  let animationFrameCanceled = false
  let resizeObserverDisconnected = false
  const observedTargets: Element[] = []
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
  Reflect.set(harness.window, "requestAnimationFrame", (callback: unknown): number => {
    if (typeof callback !== "function") throw new TypeError("Expected an animation callback.")
    animationFrameCallback = () => Reflect.apply(callback, harness.window, [0])
    animationFrameCanceled = false
    return 1
  })
  Reflect.set(harness.window, "cancelAnimationFrame", (frameId: unknown): void => {
    if (frameId === 1) {
      animationFrameCallback = undefined
      animationFrameCanceled = true
    }
  })
  Reflect.set(
    harness.window,
    "ResizeObserver",
    class {
      constructor(callback: unknown) {
        if (typeof callback !== "function") throw new TypeError("Expected a resize callback.")
        resizeCallback = () => Reflect.apply(callback, harness.window, [[], this])
      }

      observe(target: Element): void {
        observedTargets.push(target)
      }

      disconnect(): void {
        resizeObserverDisconnected = true
      }
    },
  )
  harness.window.eval(
    codeBootstrapScript({
      channel,
      surfaceId,
      documentId: options.documentId ?? "document-code",
      actions: options.actions ?? [],
      subscriptions: options.subscriptions ?? [],
      sendMessage: options.sendMessage ?? false,
      openLink: options.openLink ?? false,
      updateModelContext: options.updateModelContext ?? false,
      hostContext: options.hostContext ?? {},
      ...(options.restore === undefined ? {} : { restore: options.restore }),
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
    resizeObserver: {
      observedTargets,
      notify() {
        if (resizeCallback === undefined) throw new Error("Expected a captured resize observer.")
        resizeCallback()
      },
      runAnimationFrame() {
        const callback = animationFrameCallback
        if (callback === undefined) throw new Error("Expected a captured animation frame.")
        animationFrameCallback = undefined
        callback()
      },
      wasDisconnected: () => resizeObserverDisconnected,
      wasAnimationFrameCanceled: () => animationFrameCanceled,
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

void test("code bootstrap exposes frozen subscriptions and acknowledges events after handlers", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
      inputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
      },
      eventSchema: {
        type: "object",
        properties: { orderId: { type: "string" } },
      },
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })
  const handlerGate = deferred<void>()
  let received: unknown

  const opening = genui.subscribe("orders.changes", { status: "processing" }, async (event) => {
    received = event
    await handlerGate.promise
  })
  assert.deepEqual(jsonRoundTrip(messages.at(-1)), {
    channel,
    type: "subscription_start",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    subscription: "orders.changes",
    input: { status: "processing" },
  })

  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  const stream = await opening
  assert.equal(Object.isFrozen(stream), true)
  assert.equal(Object.isFrozen(genui.subscriptions), true)
  assert.equal(Object.isFrozen(genui.subscriptions[0]), true)
  assert.equal(Object.isFrozen(genui.subscriptions[0]?.eventSchema), true)

  dispatchInboundMessage(window, {
    channel,
    type: "subscription_event",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
    event: { order: { id: "ord-1" } },
  })
  await flushAsync()
  assert.deepEqual(jsonRoundTrip(received), { order: { id: "ord-1" } })
  assert.equal(Object.isFrozen(received), true)
  assert.equal(Object.isFrozen(isRecord(received) ? received.order : undefined), true)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "subscription_ack"),
    false,
  )

  handlerGate.resolve(undefined)
  await flushAsync()
  assert.deepEqual(jsonRoundTrip(messages.at(-1)), {
    channel,
    type: "subscription_ack",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
  })

  dispatchInboundMessage(window, {
    channel,
    type: "subscription_closed",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    result: { ok: true, reason: "completed" },
  })
  const result = await stream.done
  assert.deepEqual(jsonRoundTrip(result), { ok: true, reason: "completed" })
  assert.equal(Object.isFrozen(result), true)
})

void test("subscription IDs are unique across documents for the same surface", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const first = createHarness({ documentId: "document-a", subscriptions })
  const second = createHarness({ documentId: "document-b", subscriptions })
  const firstOpening = first.genui.subscribe("orders.changes", {}, () => undefined)
  const secondOpening = second.genui.subscribe("orders.changes", {}, () => undefined)
  const firstStart = first.messages.at(-1)
  const secondStart = second.messages.at(-1)
  assert.equal(
    isRecord(firstStart) ? firstStart.subscriptionId : undefined,
    "document-a:subscription-1",
  )
  assert.equal(
    isRecord(secondStart) ? secondStart.subscriptionId : undefined,
    "document-b:subscription-1",
  )
  assert.notEqual(
    isRecord(firstStart) ? firstStart.subscriptionId : undefined,
    isRecord(secondStart) ? secondStart.subscriptionId : undefined,
  )

  dispatchInboundMessage(first.window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-a",
    subscriptionId: "document-a:subscription-1",
  })
  dispatchInboundMessage(second.window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-b",
    subscriptionId: "document-b:subscription-1",
  })
  const [firstStream, secondStream] = await Promise.all([firstOpening, secondOpening])
  assert.equal(Object.isFrozen(firstStream), true)
  assert.equal(Object.isFrozen(secondStream), true)
})

void test("code bootstrap rejects subscription starts and handles cancellation idempotently", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })

  const denied = genui.subscribe("orders.changes", {}, () => undefined)
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_closed",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    result: { ok: false, error: { code: "blocked", message: "Blocked by policy." } },
  })
  await assertGenuiError(denied, "blocked")
  await assertGenuiError(
    genui.subscribe("orders.unknown", {}, () => undefined),
    "not_granted",
  )

  const opening = genui.subscribe("orders.changes", {}, () => undefined)
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-2",
  })
  const stream = await opening
  const first = stream.unsubscribe()
  const second = stream.unsubscribe()
  assert.equal(first, second)
  assert.equal(
    messages.filter((message) => isRecord(message) && message.type === "subscription_unsubscribe")
      .length,
    1,
  )
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_closed",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-2",
    result: { ok: true, reason: "unsubscribed" },
  })
  await Promise.all([first, second])
  assert.deepEqual(jsonRoundTrip(await stream.done), { ok: true, reason: "unsubscribed" })
})

void test("code bootstrap cancels only a failing subscription handler", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })
  const opening = genui.subscribe("orders.changes", {}, async () => {
    throw new Error("handler exploded")
  })
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  const stream = await opening
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_event",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
    event: { orderId: "ord-1" },
  })
  await flushAsync()

  assert.deepEqual(jsonRoundTrip(await stream.done), {
    ok: false,
    error: { code: "handler_failed", message: "Subscription event handler failed." },
  })
  assert.equal(
    messages.some(
      (message) =>
        isRecord(message) &&
        message.type === "guest_error" &&
        message.message === "handler exploded",
    ),
    true,
  )
  assert.equal(
    messages.some(
      (message) =>
        isRecord(message) &&
        message.type === "subscription_cancel" &&
        message.reason === "handler_failed",
    ),
    true,
  )
})

void test("code bootstrap cancels handlers that throw values with hostile error getters", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const hostile = {}
  Object.defineProperties(hostile, {
    message: {
      get() {
        throw new Error("hostile message getter")
      },
    },
    stack: {
      get() {
        throw new Error("hostile stack getter")
      },
    },
  })
  const { genui, messages, window } = createHarness({ subscriptions })
  const opening = genui.subscribe("orders.changes", {}, () => {
    throw hostile
  })
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  const stream = await opening
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_event",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
    event: { orderId: "ord-1" },
  })
  await flushAsync()

  assert.deepEqual(jsonRoundTrip(await stream.done), {
    ok: false,
    error: { code: "handler_failed", message: "Subscription event handler failed." },
  })
  assert.equal(
    messages.some(
      (message) =>
        isRecord(message) &&
        message.type === "guest_error" &&
        message.message === "Unknown guest error." &&
        !Object.hasOwn(message, "stack"),
    ),
    true,
  )
  assert.equal(
    messages.some(
      (message) =>
        isRecord(message) &&
        message.type === "subscription_cancel" &&
        message.reason === "handler_failed",
    ),
    true,
  )
})

void test("code bootstrap bounds forged early-ack event buffering", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })
  const handlerGate = deferred<void>()
  const opening = genui.subscribe("orders.changes", {}, () => handlerGate.promise)
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  const stream = await opening
  for (const sequence of [1, 2, 3]) {
    dispatchInboundMessage(window, {
      channel,
      type: "subscription_event",
      surfaceId,
      documentId: "document-code",
      subscriptionId: "document-code:subscription-1",
      sequence,
      event: { sequence },
    })
  }
  await flushAsync()
  assert.deepEqual(jsonRoundTrip(await stream.done), {
    ok: false,
    error: { code: "overflow", message: "Subscription event queue overflowed." },
  })
  assert.equal(
    messages.some(
      (message) =>
        isRecord(message) &&
        message.type === "subscription_cancel" &&
        message.reason === "overflow",
    ),
    true,
  )
  handlerGate.resolve(undefined)
})

void test("code bootstrap enforces the 64 KiB subscription input boundary", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages } = createHarness({ subscriptions })
  void genui.subscribe("orders.changes", "x".repeat(64 * 1_024 - 2), () => undefined)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "subscription_start"),
    true,
  )
  await assertGenuiError(
    genui.subscribe("orders.changes", "x".repeat(64 * 1_024 - 1), () => undefined),
    "invalid_input",
  )

  const limited = createHarness({ subscriptions }).genui
  for (let index = 0; index < 4; index += 1) {
    void limited.subscribe("orders.changes", { index }, () => undefined)
  }
  await assertGenuiError(
    limited.subscribe("orders.changes", { index: 5 }, () => undefined),
    "rate_limited",
  )
})

void test("red team: guest intrinsic tampering cannot weaken subscription handling", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })
  window.eval(`
    Promise = class BrokenPromise { constructor() { throw new Error("tampered Promise") } }
    JSON.stringify = () => { throw new Error("tampered JSON") }
    TextEncoder = class BrokenTextEncoder { constructor() { throw new Error("tampered encoder") } }
    Object.freeze = () => { throw new Error("tampered freeze") }
  `)

  let handled = false
  const opening = genui.subscribe("orders.changes", { status: "processing" }, () => {
    handled = true
  })
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  await opening
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_event",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
    event: { orderId: "ord-1" },
  })
  await flushAsync()

  assert.equal(handled, true)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "subscription_ack"),
    true,
  )
})

void test("red team: synthetic and stale-document subscription messages are ignored", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, window } = createHarness({ subscriptions })
  let settled = false
  const opening = genui
    .subscribe("orders.changes", {}, () => undefined)
    .then((stream) => {
      settled = true
      return stream
    })
  dispatchSyntheticInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "stale-document",
    subscriptionId: "document-code:subscription-1",
  })
  await flushAsync()
  assert.equal(settled, false)

  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  await opening
  assert.equal(settled, true)
})

void test("bounded broker errors settle initial and streamed subscription failures", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const surface: Surface = {
    id: surfaceId,
    dialect: codeDialect,
    content: "",
    grant: { surfaceId, actions: [], subscriptions },
  }
  const oversizedMessage = "x".repeat(3_000)
  const { genui, messages, window } = createHarness({ subscriptions })
  const broker = createSubscriptionBroker(surface, "document-code", {
    subscriptionTransport: async (request) => {
      if (request.subscriptionId === "document-code:subscription-1") {
        throw new SubscriptionTransportError("blocked", oversizedMessage)
      }
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "error",
              surfaceId,
              subscriptionId: request.subscriptionId,
              error: { code: "revoked", message: oversizedMessage },
            }
          },
        },
      }
    },
    post: (message) => dispatchInboundMessage(window, message),
    emit: () => undefined,
  })
  const routeLatestStart = (): void => {
    const parsed = parseSandboxMessage(messages.at(-1))
    if (!parsed.ok || parsed.value.type !== "subscription_start") {
      throw new Error("Expected a parsed subscription start.")
    }
    broker.handleSandboxMessage(parsed.value)
  }

  const rejected = genui.subscribe("orders.changes", {}, () => undefined)
  routeLatestStart()
  await assert.rejects(rejected, (error: unknown) => {
    assert.equal(isRecord(error) ? error.code : undefined, "blocked")
    assert.equal(
      isRecord(error) && typeof error.message === "string" ? error.message.length : 0,
      2_048,
    )
    return true
  })

  const opening = genui.subscribe("orders.changes", {}, () => undefined)
  routeLatestStart()
  const stream = await opening
  const result = await stream.done
  assert.equal(result.ok, false)
  assert.equal(result.ok ? undefined : result.error.code, "revoked")
  assert.equal(result.ok ? 0 : result.error.message.length, 2_048)
  broker.dispose()
})

void test("code bootstrap freezes deeply nested subscription events without recursion", async () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
    },
  ] satisfies readonly Subscription[]
  const { genui, messages, window } = createHarness({ subscriptions })
  let handled = false
  const opening = genui.subscribe("orders.changes", {}, () => {
    handled = true
  })
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_opened",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
  })
  await opening
  let event: Readonly<Record<string, unknown>> = {}
  for (let depth = 0; depth < 5_000; depth += 1) event = { nested: event }
  dispatchInboundMessage(window, {
    channel,
    type: "subscription_event",
    surfaceId,
    documentId: "document-code",
    subscriptionId: "document-code:subscription-1",
    sequence: 1,
    event,
  })
  await flushAsync()

  assert.equal(handled, true)
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "subscription_ack"),
    true,
  )
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

void test("code bootstrap exposes the initial deeply frozen host context", () => {
  const { genui } = createHarness({
    hostContext: {
      theme: "dark",
      containerDimensions: { width: 480, maxHeight: 720 },
      locale: "en-US",
      timeZone: "UTC",
      platform: "web",
    },
  })

  assert.deepEqual(jsonRoundTrip(genui.hostContext), {
    theme: "dark",
    containerDimensions: { width: 480, maxHeight: 720 },
    locale: "en-US",
    timeZone: "UTC",
    platform: "web",
  })
  assert.equal(Object.isFrozen(genui.hostContext), true)
  assert.equal(Object.isFrozen(genui.hostContext.containerDimensions), true)
  assert.equal(typeof genui.onHostContextChange, "function")
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
  const { window } = createHarness({ hostContext: { theme: "dark" } })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark")
  assert.equal(window.document.documentElement.style.colorScheme, "dark")
})

void test("code bootstrap applies live host theme changes", () => {
  const { window } = createHarness({ hostContext: { theme: "light" } })

  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: { theme: "dark" },
  })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark")
  assert.equal(window.document.documentElement.style.colorScheme, "dark")
})

void test("code bootstrap merges frozen host context updates before invoking the latest handler", async () => {
  const { genui, window } = createHarness({
    hostContext: {
      theme: "light",
      containerDimensions: { width: 480, maxHeight: 720 },
      locale: "en-US",
      timeZone: "UTC",
    },
  })
  let replacedHandlerCalls = 0
  let received: GuestApi["hostContext"] | undefined
  genui.onHostContextChange(() => {
    replacedHandlerCalls += 1
  })
  genui.onHostContextChange((partial) => {
    received = partial
  })

  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: {
      containerDimensions: { maxWidth: 360, height: 240 },
      locale: "fr-FR",
      platform: "mobile",
    },
  })

  assert.deepEqual(jsonRoundTrip(genui.hostContext), {
    theme: "light",
    containerDimensions: { maxWidth: 360, height: 240 },
    locale: "fr-FR",
    timeZone: "UTC",
    platform: "mobile",
  })
  await flushAsync()
  assert.equal(replacedHandlerCalls, 0)
  assert.deepEqual(jsonRoundTrip(received), {
    containerDimensions: { maxWidth: 360, height: 240 },
    locale: "fr-FR",
    platform: "mobile",
  })
  assert.equal(Object.isFrozen(received), true)
  assert.equal(Object.isFrozen(received?.containerDimensions), true)

  received = undefined
  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: {
      theme: "light",
      containerDimensions: { maxWidth: 360, height: 240 },
      locale: "fr-FR",
      timeZone: "UTC",
      platform: "mobile",
    },
  })
  await flushAsync()
  assert.equal(received, undefined)
})

void test("code bootstrap reports host context handler failures after applying updates", async () => {
  const { genui, messages, window } = createHarness({ hostContext: { locale: "en-US" } })
  assert.throws(
    () => genui.onHostContextChange("invalid" as never),
    /Host context change handler must be a function/,
  )
  genui.onHostContextChange(() => {
    throw new Error("Context handler failed")
  })

  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: { locale: "de-DE" },
  })
  await flushAsync()

  assert.equal(genui.hostContext.locale, "de-DE")
  const guestError = messages.find((message) => isRecord(message) && message.type === "guest_error")
  assert.ok(isRecord(guestError))
  assert.equal(guestError.message, "Context handler failed")

  genui.onHostContextChange(async () => {
    throw new Error("Async context handler failed")
  })
  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: { timeZone: "Europe/Berlin" },
  })
  await flushAsync()

  assert.equal(genui.hostContext.timeZone, "Europe/Berlin")
  assert.deepEqual(
    messages
      .filter((message) => isRecord(message) && message.type === "guest_error")
      .map((message) => (isRecord(message) ? message.message : undefined)),
    ["Context handler failed", "Async context handler failed"],
  )
})

void test("red team: code bootstrap ignores forged and invalid host theme changes", () => {
  const { window } = createHarness({ hostContext: { theme: "light" } })
  const update = {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: { theme: "dark" },
  }

  dispatchInboundMessage(window, update, "forged")
  dispatchInboundMessage(window, { ...update, channel: "forged/channel" })
  dispatchInboundMessage(window, { ...update, surfaceId: "forged-surface" })
  dispatchInboundMessage(window, { ...update, context: { theme: "sepia" } })
  dispatchInboundMessage(window, { ...update, context: { locale: "not_a_locale" } })
  dispatchInboundMessage(window, {
    ...update,
    context: { containerDimensions: { width: 100, maxWidth: 200 } },
  })
  dispatchInboundMessage(window, { ...update, extra: true })
  dispatchInboundMessage(window, {
    ...update,
    context: Object.create({ theme: "dark" }),
  })

  assert.equal(window.document.documentElement.getAttribute("data-theme"), "light")
  assert.equal(window.document.documentElement.style.colorScheme, "light")
})

void test("red team: guest intrinsic tampering cannot weaken live context validation or freezing", async () => {
  const { genui, window } = createHarness({ hostContext: { locale: "en-US" } })
  let received: GuestHostContext | undefined
  genui.onHostContextChange((partial) => {
    received = partial
  })
  window.eval(`
    Object.freeze = (value) => value
    Object.keys = () => []
    Array.isArray = () => true
    Array.prototype.every = () => true
    Array.prototype.some = () => false
    Number.isFinite = () => false
    Set.prototype.has = () => true
    Promise.resolve = () => ({ then() { return this }, catch() { return this } })
    Intl.getCanonicalLocales = () => []
    Intl.DateTimeFormat = function () { throw new Error("tampered") }
  `)

  dispatchInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: {
      containerDimensions: { width: 320, maxHeight: 480 },
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
    },
  })
  await flushAsync()

  assert.equal(genui.hostContext.locale, "ja-JP")
  assert.equal(genui.hostContext.timeZone, "Asia/Tokyo")
  assert.equal(Object.isFrozen(genui.hostContext), true)
  assert.equal(Object.isFrozen(genui.hostContext.containerDimensions), true)
  assert.equal(Object.isFrozen(received), true)
  assert.equal(Object.isFrozen(received?.containerDimensions), true)
})

void test("red team: a synthetic parent-sourced event cannot forge host context", async () => {
  const { genui, window } = createHarness({ hostContext: { locale: "en-US" } })
  let handlerCalls = 0
  genui.onHostContextChange(() => {
    handlerCalls += 1
  })

  dispatchSyntheticInboundMessage(window, {
    channel,
    type: "host_context_changed",
    surfaceId,
    context: { locale: "ja-JP" },
  })
  await flushAsync()

  assert.equal(genui.hostContext.locale, "en-US")
  assert.equal(handlerCalls, 0)
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

void test("code bootstrap debounces complete size reports and stops observing on pagehide", async () => {
  const { messages, resizeObserver, window } = createHarness()
  let contentHeight = 80.2
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 319.2 })
  Object.defineProperty(window.document.documentElement, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: contentHeight }),
  })
  window.document.documentElement.style.height = "25px"

  await Promise.resolve()
  resizeObserver.notify()
  resizeObserver.notify()
  resizeObserver.runAnimationFrame()

  const sizeReports = () =>
    messages.filter((message) => isRecord(message) && message.type === "resize")
  assert.deepEqual(sizeReports().map(jsonRoundTrip), [
    { channel, surfaceId, type: "resize", width: 320, height: 81 },
  ])
  assert.deepEqual(resizeObserver.observedTargets, [
    window.document.documentElement,
    window.document.body,
  ])
  assert.equal(window.document.documentElement.style.height, "25px")

  resizeObserver.notify()
  resizeObserver.runAnimationFrame()
  assert.equal(sizeReports().length, 1)

  contentHeight = 100.1
  resizeObserver.notify()
  resizeObserver.runAnimationFrame()
  assert.deepEqual(sizeReports().map(jsonRoundTrip), [
    { channel, surfaceId, type: "resize", width: 320, height: 81 },
    { channel, surfaceId, type: "resize", width: 320, height: 101 },
  ])

  resizeObserver.notify()
  window.dispatchEvent(new window.Event("pagehide"))
  assert.equal(resizeObserver.wasDisconnected(), true)
  assert.equal(resizeObserver.wasAnimationFrameCanceled(), true)
  assert.equal(sizeReports().length, 2)
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
