import assert from "node:assert/strict"
import { test } from "node:test"
import { codeDialect, subscriptionEventByteLimit, type Surface } from "../protocol/index.js"
import { deferred, flushAsync } from "./test-support.test-support.js"
import { protocolChannel } from "./protocol.js"
import {
  createSubscriptionBroker,
  SubscriptionTransportError,
  type SubscriptionBroker,
  type SubscriptionHostMessage,
} from "./subscription-broker.js"
import type { SnapshotValue, SubscriptionStartSandboxMessage } from "./sandbox-message-schema.js"
import type { SurfaceEvent } from "./surface-events.js"

const subscription = {
  name: "orders.changes",
  description: "Receive order changes.",
  confidentiality: "normal",
  maxEventBytes: subscriptionEventByteLimit,
} as const

const surface = (id = "surface-subscriptions"): Surface => ({
  id,
  content: "",
  dialect: codeDialect,
  grant: { surfaceId: id, actions: [], subscriptions: [subscription] },
})

const startMessage = (
  options: {
    readonly subscriptionId?: string
    readonly documentId?: string
    readonly input?: SnapshotValue
  } = {},
): SubscriptionStartSandboxMessage => {
  const documentId = options.documentId ?? "document-1"
  return {
    channel: protocolChannel,
    type: "subscription_start",
    surfaceId: "surface-subscriptions",
    documentId,
    subscriptionId: options.subscriptionId ?? `${documentId}:subscription-1`,
    subscription: "orders.changes",
    input: options.input ?? { status: "processing" },
  }
}

void test("subscription broker opens, delivers one event at a time, and completes after ack", async () => {
  const posts: SubscriptionHostMessage[] = []
  const events: SurfaceEvent[] = []
  const secondEvent = deferred<void>()
  async function* source() {
    yield {
      type: "event" as const,
      surfaceId: "surface-subscriptions",
      subscriptionId: "document-1:subscription-1",
      sequence: 1,
      event: { orderId: "ord-1" },
    }
    await secondEvent.promise
  }
  const broker = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async () => ({ events: source() }),
    post: (message) => posts.push(message),
    emit: (event) => events.push(event),
  })

  broker.handleSandboxMessage(startMessage())
  await flushAsync()

  assert.deepEqual(posts.slice(0, 2), [
    {
      channel: protocolChannel,
      type: "subscription_opened",
      surfaceId: "surface-subscriptions",
      documentId: "document-1",
      subscriptionId: "document-1:subscription-1",
    },
    {
      channel: protocolChannel,
      type: "subscription_event",
      surfaceId: "surface-subscriptions",
      documentId: "document-1",
      subscriptionId: "document-1:subscription-1",
      sequence: 1,
      event: { orderId: "ord-1" },
    },
  ])
  assert.equal(
    events.some((event) => event.type === "subscription_event"),
    true,
  )

  broker.handleSandboxMessage({
    channel: protocolChannel,
    type: "subscription_ack",
    surfaceId: "surface-subscriptions",
    documentId: "document-1",
    subscriptionId: "document-1:subscription-1",
    sequence: 1,
  })
  secondEvent.resolve(undefined)
  await flushAsync()

  assert.deepEqual(posts.at(-1), {
    channel: protocolChannel,
    type: "subscription_closed",
    surfaceId: "surface-subscriptions",
    documentId: "document-1",
    subscriptionId: "document-1:subscription-1",
    result: { ok: true, reason: "completed" },
  })
})

void test("subscription broker enforces input size and counts starting subscriptions", async () => {
  const posts: SubscriptionHostMessage[] = []
  const starts: string[] = []
  const pending = deferred<never>()
  const broker = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async (request) => {
      starts.push(request.subscriptionId)
      return await pending.promise
    },
    post: (message) => posts.push(message),
    emit: () => undefined,
  })

  broker.handleSandboxMessage(
    startMessage({
      subscriptionId: "document-1:exact",
      input: "x".repeat(64 * 1_024 - 2),
    }),
  )
  await flushAsync()
  assert.deepEqual(starts, ["document-1:exact"])

  broker.dispose()
  const limitedPosts: SubscriptionHostMessage[] = []
  const limitedStarts: string[] = []
  const limited = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async (request) => {
      limitedStarts.push(request.subscriptionId)
      return await pending.promise
    },
    post: (message) => limitedPosts.push(message),
    emit: () => undefined,
  })
  limited.handleSandboxMessage(
    startMessage({
      subscriptionId: "document-1:oversized",
      input: "x".repeat(64 * 1_024 - 1),
    }),
  )
  for (let index = 1; index <= 5; index += 1) {
    limited.handleSandboxMessage(startMessage({ subscriptionId: `document-1:active-${index}` }))
  }
  await flushAsync()

  assert.deepEqual(limitedStarts, [
    "document-1:active-1",
    "document-1:active-2",
    "document-1:active-3",
    "document-1:active-4",
  ])
  const failures = limitedPosts.filter(
    (message) => message.type === "subscription_closed" && !message.result.ok,
  )
  assert.deepEqual(
    failures.map((message) =>
      message.type === "subscription_closed" && !message.result.ok
        ? message.result.error.code
        : undefined,
    ),
    ["invalid_input", "rate_limited"],
  )
  limited.dispose()
})

void test("subscription broker copies input before invoking an asynchronous transport", async () => {
  let received: unknown
  const input = { filter: { status: "processing" } }
  const broker = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async (request) => {
      received = request.input
      return { events: { async *[Symbol.asyncIterator]() {} } }
    },
    post: () => undefined,
    emit: () => undefined,
  })

  broker.handleSandboxMessage(startMessage({ input }))
  input.filter.status = "mutated"
  await flushAsync()

  assert.deepEqual(received, { filter: { status: "processing" } })
  broker.dispose()
})

void test("subscription broker preserves expected transport errors and redacts arbitrary failures", async () => {
  for (const testCase of [
    {
      error: new SubscriptionTransportError("blocked", "Blocked by current policy."),
      expected: { code: "blocked", message: "Blocked by current policy." },
    },
    {
      error: new Error("secret transport detail"),
      expected: { code: "transport_failed", message: "Subscription transport failed." },
    },
  ] as const) {
    const posts: SubscriptionHostMessage[] = []
    const broker = createSubscriptionBroker(surface(), "document-1", {
      subscriptionTransport: async () => {
        throw testCase.error
      },
      post: (message) => posts.push(message),
      emit: () => undefined,
    })
    broker.handleSandboxMessage(startMessage())
    await flushAsync()
    const closed = posts.find((message) => message.type === "subscription_closed")
    assert.deepEqual(
      closed?.type === "subscription_closed" && !closed.result.ok ? closed.result.error : undefined,
      testCase.expected,
    )
    broker.dispose()
  }
})

void test("subscription broker bounds initial and streamed terminal error messages", async () => {
  const oversizedMessage = "x".repeat(3_000)
  for (const subscriptionTransport of [
    async () => {
      throw new SubscriptionTransportError("blocked", oversizedMessage)
    },
    async () => ({
      events: {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "error",
            surfaceId: "surface-subscriptions",
            subscriptionId: "document-1:subscription-1",
            error: { code: "revoked", message: oversizedMessage },
          }
        },
      },
    }),
  ] as const) {
    const posts: SubscriptionHostMessage[] = []
    const broker = createSubscriptionBroker(surface(), "document-1", {
      subscriptionTransport,
      post: (message) => posts.push(message),
      emit: () => undefined,
    })
    broker.handleSandboxMessage(startMessage())
    await flushAsync()
    const closed = posts.find((message) => message.type === "subscription_closed")
    const message =
      closed?.type === "subscription_closed" && !closed.result.ok
        ? closed.result.error.message
        : undefined
    assert.equal(message?.length, 2_048)
    assert.equal(message?.endsWith("..."), true)
    broker.dispose()
  }
})

void test("subscription broker enforces event size and the aggregate delivery rate after forged acks", async () => {
  const posts: SubscriptionHostMessage[] = []
  async function* source() {
    for (let sequence = 1; sequence <= 11; sequence += 1) {
      yield {
        type: "event" as const,
        surfaceId: "surface-subscriptions",
        subscriptionId: "document-1:subscription-1",
        sequence,
        event: { sequence },
      }
    }
  }
  const broker = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async () => ({ events: source() }),
    post: (message) => posts.push(message),
    emit: () => undefined,
    now: () => 100,
    schedule: () => () => undefined,
  })
  broker.handleSandboxMessage(startMessage())
  await flushAsync()
  for (let sequence = 1; sequence <= 10; sequence += 1) {
    assert.equal(
      posts.some(
        (message) => message.type === "subscription_event" && message.sequence === sequence,
      ),
      true,
    )
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "subscription_ack",
      surfaceId: "surface-subscriptions",
      documentId: "document-1",
      subscriptionId: "document-1:subscription-1",
      sequence,
    })
    await flushAsync()
  }
  assert.deepEqual(posts.at(-1), {
    channel: protocolChannel,
    type: "subscription_closed",
    surfaceId: "surface-subscriptions",
    documentId: "document-1",
    subscriptionId: "document-1:subscription-1",
    result: {
      ok: false,
      error: {
        code: "rate_limited",
        message: "Subscription event rate exceeded 10 events per second.",
      },
    },
  })

  const exactPosts: SubscriptionHostMessage[] = []
  async function* exactSource() {
    yield {
      type: "event" as const,
      surfaceId: "surface-subscriptions",
      subscriptionId: "document-1:subscription-1",
      sequence: 1,
      event: "x".repeat(64 * 1_024 - 2),
    }
  }
  const exact = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async () => ({ events: exactSource() }),
    post: (message) => exactPosts.push(message),
    emit: () => undefined,
  })
  exact.handleSandboxMessage(startMessage())
  await flushAsync()
  assert.equal(
    exactPosts.some((message) => message.type === "subscription_event"),
    true,
  )
  exact.dispose()

  const oversizedPosts: SubscriptionHostMessage[] = []
  async function* oversizedSource() {
    yield {
      type: "event" as const,
      surfaceId: "surface-subscriptions",
      subscriptionId: "document-1:subscription-1",
      sequence: 1,
      event: "x".repeat(64 * 1_024 - 1),
    }
  }
  const oversized = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async () => ({ events: oversizedSource() }),
    post: (message) => oversizedPosts.push(message),
    emit: () => undefined,
  })
  oversized.handleSandboxMessage(startMessage())
  await flushAsync()
  assert.equal(
    oversizedPosts.some(
      (message) =>
        message.type === "subscription_closed" &&
        !message.result.ok &&
        message.result.error.code === "event_too_large",
    ),
    true,
  )
})

void test("subscription broker times out acknowledgments and aborts replacement streams", async () => {
  const posts: SubscriptionHostMessage[] = []
  const signals: AbortSignal[] = []
  const timeouts: Array<() => void> = []
  let returned = false
  const next = deferred<IteratorResult<unknown>>()
  const source: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      let delivered = false
      return {
        next() {
          if (!delivered) {
            delivered = true
            return Promise.resolve({
              done: false,
              value: {
                type: "event",
                surfaceId: "surface-subscriptions",
                subscriptionId: "document-1:subscription-1",
                sequence: 1,
                event: { ok: true },
              },
            })
          }
          return next.promise
        },
        async return() {
          returned = true
          return { done: true, value: undefined }
        },
      }
    },
  }
  const broker = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async (_request, options) => {
      signals.push(options.signal)
      return { events: source }
    },
    post: (message) => posts.push(message),
    emit: () => undefined,
    schedule: (callback) => {
      timeouts.push(callback)
      return () => undefined
    },
  })
  broker.handleSandboxMessage(startMessage())
  await flushAsync()
  timeouts[0]?.()
  assert.equal(signals[0]?.aborted, true)
  assert.equal(returned, true)
  assert.equal(
    posts.some(
      (message) =>
        message.type === "subscription_closed" &&
        !message.result.ok &&
        message.result.error.code === "ack_timeout",
    ),
    true,
  )

  const replacementPosts: SubscriptionHostMessage[] = []
  const replacementSignal = deferred<AbortSignal>()
  const replacement = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async (_request, options) => {
      replacementSignal.resolve(options.signal)
      return { events: source }
    },
    post: (message) => replacementPosts.push(message),
    emit: () => undefined,
    schedule: () => () => undefined,
  })
  replacement.handleSandboxMessage(startMessage())
  const signal = await replacementSignal.promise
  await flushAsync()
  const nextSurface = surface()
  replacement.replace(nextSurface, "document-2")
  assert.equal(signal.aborted, true)
  const postCount = replacementPosts.length
  replacement.handleSandboxMessage(startMessage({ documentId: "document-1" }))
  await flushAsync()
  assert.equal(replacementPosts.length, postCount)
})

void test("subscription broker does not start transport after reentrant or queued cancellation", async () => {
  for (const lifecycle of ["dispose", "replace"] as const) {
    let broker: SubscriptionBroker | undefined
    let transportCalls = 0
    broker = createSubscriptionBroker(surface(), "document-1", {
      subscriptionTransport: async () => {
        transportCalls += 1
        return { events: { async *[Symbol.asyncIterator]() {} } }
      },
      post: () => undefined,
      emit(event) {
        if (event.type !== "subscription_start") return
        if (lifecycle === "dispose") broker?.dispose()
        else broker?.replace(surface(), "document-2")
      },
    })
    broker.handleSandboxMessage(startMessage())
    await flushAsync()
    assert.equal(transportCalls, 0)
  }

  let queuedTransportCalls = 0
  const queued = createSubscriptionBroker(surface(), "document-1", {
    subscriptionTransport: async () => {
      queuedTransportCalls += 1
      return { events: { async *[Symbol.asyncIterator]() {} } }
    },
    post: () => undefined,
    emit: () => undefined,
  })
  queued.handleSandboxMessage(startMessage())
  queued.dispose()
  await flushAsync()
  assert.equal(queuedTransportCalls, 0)
})
