import assert from "node:assert/strict"
import { test } from "node:test"
import type { SubscriptionDelivery, SubscriptionOpenResult } from "./protocol/index.js"
import { Genui, subscription } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { SubscriptionAuditEntry } from "./subscription-runtime.js"
import type { SurfaceStore } from "./types.js"

interface Filter {
  readonly status: string
}

interface Change {
  readonly id: string
}

const filterSchema = testSchema<Filter>((value) =>
  isRecord(value) && typeof value.status === "string"
    ? { ok: true, value: { status: value.status.trim().toLowerCase() } }
    : { ok: false, message: "status must be a string." },
)

const changeSchema = testSchema<Change>((value) =>
  isRecord(value) && typeof value.id === "string"
    ? { ok: true, value: { id: value.id.trim() } }
    : { ok: false, message: "id must be a string." },
)

interface ControlledSource {
  readonly events: AsyncIterable<unknown>
  readonly returned: Promise<void>
  push(value: unknown): void
  complete(): void
  fail(cause: unknown): void
}

const controlledSource = (): ControlledSource => {
  const queued: Array<IteratorResult<unknown> | { readonly error: unknown }> = []
  const waiting: Array<{
    resolve(value: IteratorResult<unknown>): void
    reject(cause: unknown): void
  }> = []
  let resolveReturned: (() => void) | undefined
  const returned = new Promise<void>((resolve) => {
    resolveReturned = resolve
  })
  const take = (): Promise<IteratorResult<unknown>> => {
    const next = queued.shift()
    if (next !== undefined) {
      return "error" in next ? Promise.reject(next.error) : Promise.resolve(next)
    }
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
  }
  const deliver = (next: IteratorResult<unknown> | { readonly error: unknown }): void => {
    const waiter = waiting.shift()
    if (waiter === undefined) {
      queued.push(next)
      return
    }
    if ("error" in next) waiter.reject(next.error)
    else waiter.resolve(next)
  }

  return {
    events: {
      [Symbol.asyncIterator]() {
        return {
          next: take,
          return: async () => {
            resolveReturned?.()
            for (const waiter of waiting.splice(0)) waiter.resolve({ done: true, value: undefined })
            return { done: true, value: undefined }
          },
        }
      },
    },
    returned,
    push: (value) => deliver({ done: false, value }),
    complete: () => deliver({ done: true, value: undefined }),
    fail: (cause) => deliver({ error: cause }),
  }
}

const openedEvents = (result: SubscriptionOpenResult): AsyncIterable<SubscriptionDelivery> => {
  if (!result.ok) assert.fail(result.error.message)
  return result.events
}

void test("subscription validates canonical input and every event without retaining request data", async () => {
  const source = controlledSource()
  let receivedInput: Filter | undefined
  let receivedSignal: AbortSignal | undefined
  const audit: SubscriptionAuditEntry[] = []
  const registry = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: filterSchema,
        event: changeSchema,
        subscribe: (_ctx, input, { signal }) => {
          receivedInput = input
          receivedSignal = signal
          return source.events
        },
      }),
    ],
    onSubscription: (entry) => {
      audit.push(entry)
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const request = {
    surfaceId: surface.id,
    subscriptionId: "subscription-1",
    subscription: "orders.changes",
    input: { status: " PROCESSING " },
  }
  const opening = registry.subscribe(request, {})
  request.surfaceId = "surface-forged"
  request.subscriptionId = "subscription-forged"
  request.subscription = "orders.forged"
  request.input.status = "forged"
  const events = openedEvents(await opening)

  assert.deepEqual(receivedInput, { status: "processing" })
  assert.equal(receivedSignal?.aborted, false)
  const iterator = events[Symbol.asyncIterator]()
  const first = iterator.next()
  source.push({ id: " ord-1 " })
  assert.deepEqual(await first, {
    done: false,
    value: {
      type: "event",
      surfaceId: surface.id,
      subscriptionId: "subscription-1",
      sequence: 1,
      event: { id: "ord-1" },
    },
  })
  const completed = iterator.next()
  source.complete()
  assert.deepEqual(await completed, { done: true, value: undefined })
  assert.deepEqual(
    audit.map((entry) => entry.type),
    ["start", "event", "close"],
  )
  const close = audit[2]
  assert.equal(close?.type === "close" ? close.reason : undefined, "completed")
})

void test("subscription enforces subject, input size, duplicate IDs, and four active streams", async () => {
  const sources: ControlledSource[] = []
  const audit: SubscriptionAuditEntry[] = []
  const registry = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: testSchema<Record<string, unknown>>((value) =>
          isRecord(value) ? { ok: true, value: { ...value } } : { ok: false, message: "object" },
        ),
        event: changeSchema,
        subscribe: (_ctx, _input, { signal }) => {
          const source = controlledSource()
          sources.push(source)
          signal.addEventListener("abort", () => source.complete(), { once: true })
          return source.events
        },
      }),
    ],
    onSubscription: (entry) => {
      audit.push(entry)
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
    subject: "session-1",
  })
  const request = (subscriptionId: string, input: unknown = {}) => ({
    surfaceId: surface.id,
    subscriptionId,
    subscription: "orders.changes",
    input,
  })

  const wrongSubject = await registry.subscribe(request("wrong-subject"), {}, { subject: "other" })
  assert.equal(wrongSubject.ok ? undefined : wrongSubject.error.code, "not_granted")

  const overhead = new TextEncoder().encode(JSON.stringify({ text: "" })).byteLength
  const exact = await registry.subscribe(
    request("exact", { text: "x".repeat(64 * 1_024 - overhead) }),
    {},
    { subject: "session-1" },
  )
  assert.equal(exact.ok, true)
  const duplicate = await registry.subscribe(request("exact"), {}, { subject: "session-1" })
  assert.equal(duplicate.ok ? undefined : duplicate.error.code, "invalid_input")
  const controllers: AbortController[] = [new AbortController()]
  const opened: SubscriptionOpenResult[] = [exact]
  for (let index = 1; index < 4; index += 1) {
    const controller = new AbortController()
    controllers.push(controller)
    opened.push(
      await registry.subscribe(
        request(`subscription-${index}`),
        {},
        {
          subject: "session-1",
          signal: controller.signal,
        },
      ),
    )
  }
  assert.equal(
    opened.every((item) => item.ok),
    true,
  )
  const fifth = await registry.subscribe(request("subscription-5"), {}, { subject: "session-1" })
  assert.equal(fifth.ok ? undefined : fifth.error.code, "rate_limited")
  controllers.forEach((controller) => controller.abort())
  assert.equal(
    audit.some((entry) => entry.type === "close" && entry.reason === "cancelled"),
    true,
  )
  await registry.revoke(surface.id)

  const oversizedRegistry = new Genui({
    actions: [],
    subscriptions: registry.subscriptions().map(() =>
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: testSchema<Record<string, unknown>>((value) =>
          isRecord(value) ? { ok: true, value } : { ok: false, message: "object" },
        ),
        event: changeSchema,
        subscribe: async function* () {},
      }),
    ),
  })
  const oversizedSurface = await oversizedRegistry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const oversized = await oversizedRegistry.subscribe(
    {
      surfaceId: oversizedSurface.id,
      subscriptionId: "oversized",
      subscription: "orders.changes",
      input: { text: "x".repeat(64 * 1_024 - overhead + 1) },
    },
    {},
  )
  assert.equal(oversized.ok ? undefined : oversized.error.code, "invalid_input")
})

void test("subscription cancellation before the first pull releases its active slot", async () => {
  const signals: AbortSignal[] = []
  const audit: SubscriptionAuditEntry[] = []
  let returned = 0
  const registry = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: filterSchema,
        event: changeSchema,
        subscribe: (_ctx, _input, { signal }) => {
          signals.push(signal)
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => new Promise<IteratorResult<unknown>>(() => undefined),
                return: async () => {
                  returned += 1
                  return { done: true, value: undefined }
                },
              }
            },
          }
        },
      }),
    ],
    onSubscription: (entry) => {
      audit.push(entry)
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const open = (subscriptionId: string): Promise<SubscriptionOpenResult> =>
    registry.subscribe(
      {
        surfaceId: surface.id,
        subscriptionId,
        subscription: "orders.changes",
        input: { status: "processing" },
      },
      {},
    )

  for (let index = 1; index <= 4; index += 1) {
    const iterator = openedEvents(await open(`subscription-${index}`))[Symbol.asyncIterator]()
    if (iterator.return === undefined) assert.fail("Expected subscription iterator cancellation.")
    await iterator.return()
  }

  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  )
  assert.equal(returned, 4)
  assert.deepEqual(
    audit.flatMap((entry) => (entry.type === "close" ? [entry.reason] : [])),
    ["cancelled", "cancelled", "cancelled", "cancelled"],
  )

  const fifth = await open("subscription-5")
  assert.equal(fifth.ok, true)
  const fifthIterator = openedEvents(fifth)[Symbol.asyncIterator]()
  const sentinel = new Error("consumer stopped")
  if (fifthIterator.throw === undefined) assert.fail("Expected subscription iterator failure.")
  await assert.rejects(fifthIterator.throw(sentinel), (cause: unknown) => cause === sentinel)
  if (fifthIterator.return === undefined)
    assert.fail("Expected subscription iterator cancellation.")
  await fifthIterator.return()
  assert.equal(signals[4]?.aborted, true)
  assert.equal(returned, 5)
  assert.equal(
    audit.filter((entry) => entry.type === "close" && entry.reason === "cancelled").length,
    5,
  )

  const sixth = await open("subscription-6")
  assert.equal(sixth.ok, true)
  const sixthIterator = openedEvents(sixth)[Symbol.asyncIterator]()
  if (sixthIterator.return === undefined)
    assert.fail("Expected subscription iterator cancellation.")
  await sixthIterator.return()
})

void test("subscription reauthorizes and fails closed before delivering later events", async () => {
  const store = memoryStore()
  const policySource = controlledSource()
  const grantSource = controlledSource()
  const revokedSource = controlledSource()
  const sources = [policySource, grantSource, revokedSource]
  const definition = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: filterSchema,
    event: changeSchema,
    subscribe: () => {
      const source = sources.shift()
      if (source === undefined) throw new Error("missing source")
      return source.events
    },
  })
  const creator = new Genui({ actions: [], subscriptions: [definition], store })
  const executor = new Genui({ actions: [], subscriptions: [definition], store })
  const surface = await creator.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const result = await executor.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "subscription-1",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const iterator = openedEvents(result)[Symbol.asyncIterator]()
  Reflect.set(definition, "policy", "block")
  const blockedNext = iterator.next()
  policySource.push({ id: "ord-blocked" })
  const blocked = await blockedNext
  assert.equal(
    blocked.done || blocked.value.type !== "error" ? undefined : blocked.value.error.code,
    "blocked",
  )

  Reflect.set(definition, "policy", "allow")
  const grantResult = await executor.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "subscription-2",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const grantIterator = openedEvents(grantResult)[Symbol.asyncIterator]()
  const hardener = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: definition.name,
        description: definition.description,
        policy: "block",
        input: filterSchema,
        event: changeSchema,
        subscribe: async function* () {},
      }),
    ],
    store,
  })
  await hardener.reproject(surface.id)
  const ungrantedNext = grantIterator.next()
  grantSource.push({ id: "ord-ungranted" })
  const ungranted = await ungrantedNext
  assert.equal(
    ungranted.done || ungranted.value.type !== "error" ? undefined : ungranted.value.error.code,
    "not_granted",
  )

  const revokedSurface = await creator.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const revokedResult = await executor.subscribe(
    {
      surfaceId: revokedSurface.id,
      subscriptionId: "subscription-3",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const revokedIterator = openedEvents(revokedResult)[Symbol.asyncIterator]()
  await creator.revoke(revokedSurface.id)
  const next = revokedIterator.next()
  revokedSource.push({ id: "ord-1" })
  const delivery = await next
  assert.equal(delivery.done, false)
  assert.equal(
    delivery.done || delivery.value.type !== "error" ? undefined : delivery.value.error.code,
    "revoked",
  )
  await revokedSource.returned
})

void test("subscription terminates malformed, oversized, throwing, and accessor-hostile sources", async () => {
  const errors: Array<{ readonly type: string; readonly phase: string }> = []
  const source = controlledSource()
  const registry = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: filterSchema,
        event: changeSchema,
        subscribe: () => source.events,
      }),
    ],
    onError: (event) => {
      errors.push({ type: event.type, phase: event.phase })
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const result = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "invalid-event",
      subscription: "orders.changes",
      input: { status: "processing" },
    },
    {},
  )
  const iterator = openedEvents(result)[Symbol.asyncIterator]()
  const next = iterator.next()
  source.push({ id: 42 })
  const delivery = await next
  assert.equal(
    delivery.done || delivery.value.type !== "error" ? undefined : delivery.value.error.code,
    "invalid_event",
  )
  assert.deepEqual(errors, [{ type: "subscription", phase: "event_validation" }])

  const exactSource = controlledSource()
  const throwingSource = controlledSource()
  const sizedSources = [exactSource, throwingSource]
  const sizedRegistry = new Genui({
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.sized",
        description: "Sized events.",
        input: filterSchema,
        event: changeSchema,
        subscribe: () => {
          const nextSource = sizedSources.shift()
          if (nextSource === undefined) throw new Error("missing source")
          return nextSource.events
        },
      }),
    ],
  })
  const sizedSurface = await sizedRegistry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.sized"],
  })
  const eventOverhead = new TextEncoder().encode(JSON.stringify({ id: "" })).byteLength
  const exactResult = await sizedRegistry.subscribe(
    {
      surfaceId: sizedSurface.id,
      subscriptionId: "exact-event",
      subscription: "orders.sized",
      input: { status: "processing" },
    },
    {},
  )
  const exactIterator = openedEvents(exactResult)[Symbol.asyncIterator]()
  const exactNext = exactIterator.next()
  exactSource.push({ id: "x".repeat(64 * 1_024 - eventOverhead) })
  const exactDelivery = await exactNext
  assert.equal(exactDelivery.done ? undefined : exactDelivery.value.type, "event")
  const oversizedNext = exactIterator.next()
  exactSource.push({ id: "x".repeat(64 * 1_024 - eventOverhead + 1) })
  const oversizedDelivery = await oversizedNext
  assert.equal(
    oversizedDelivery.done || oversizedDelivery.value.type !== "error"
      ? undefined
      : oversizedDelivery.value.error.code,
    "event_too_large",
  )

  const throwingResult = await sizedRegistry.subscribe(
    {
      surfaceId: sizedSurface.id,
      subscriptionId: "throwing-source",
      subscription: "orders.sized",
      input: { status: "processing" },
    },
    {},
  )
  const throwingNext = openedEvents(throwingResult)[Symbol.asyncIterator]().next()
  throwingSource.fail(new Error("source exploded"))
  const throwingDelivery = await throwingNext
  assert.equal(
    throwingDelivery.done || throwingDelivery.value.type !== "error"
      ? undefined
      : throwingDelivery.value.error.code,
    "source_failed",
  )

  const hostile = subscription({
    name: "orders.hostile",
    description: "Hostile source.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(hostile, "subscribe", () => {
    const value = {}
    Object.defineProperty(value, Symbol.asyncIterator, {
      get: () => {
        throw new Error("accessor exploded")
      },
    })
    return value
  })
  const hostileRegistry = new Genui({ actions: [], subscriptions: [hostile] })
  const hostileSurface = await hostileRegistry.surface({
    content: "",
    actions: [],
    subscriptions: [hostile.name],
  })
  const hostileResult = await hostileRegistry.subscribe(
    {
      surfaceId: hostileSurface.id,
      subscriptionId: "hostile",
      subscription: hostile.name,
      input: { status: "processing" },
    },
    {},
  )
  assert.equal(hostileResult.ok ? undefined : hostileResult.error.code, "source_failed")
})

void test("local revocation and exact expiry abort quiet subscription sources", async () => {
  const sources: ControlledSource[] = []
  const signals: AbortSignal[] = []
  const store = memoryStore()
  const registry = new Genui({
    store,
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: filterSchema,
        event: changeSchema,
        subscribe: (_ctx, _input, { signal }) => {
          const source = controlledSource()
          sources.push(source)
          signals.push(signal)
          return source.events
        },
      }),
    ],
  })
  const revokedSurface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const revoked = await registry.subscribe(
    {
      surfaceId: revokedSurface.id,
      subscriptionId: "revoked",
      subscription: "orders.changes",
      input: { status: "processing" },
    },
    {},
  )
  const revokedNext = openedEvents(revoked)[Symbol.asyncIterator]().next()
  await registry.revoke(revokedSurface.id)
  assert.equal(signals[0]?.aborted, true)
  const revokedDelivery = await revokedNext
  assert.equal(
    revokedDelivery.done || revokedDelivery.value.type !== "error"
      ? undefined
      : revokedDelivery.value.error.code,
    "revoked",
  )

  const expiringSurface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
    ttlMs: 20,
  })
  const expiring = await registry.subscribe(
    {
      surfaceId: expiringSurface.id,
      subscriptionId: "expiring",
      subscription: "orders.changes",
      input: { status: "processing" },
    },
    {},
  )
  const expiringNext = openedEvents(expiring)[Symbol.asyncIterator]().next()
  const expiredDelivery = await expiringNext
  assert.equal(signals[1]?.aborted, true)
  assert.equal(
    expiredDelivery.done || expiredDelivery.value.type !== "error"
      ? undefined
      : expiredDelivery.value.error.code,
    "expired",
  )
  const expiredSource = sources[1]
  assert.notEqual(expiredSource, undefined)
  if (expiredSource !== undefined) await expiredSource.returned
  assert.equal(await store.get(expiringSurface.id), undefined)
})

void test("revocation overlapping initial authorization prevents a stale open", async () => {
  const backing = memoryStore()
  let releaseRead: (() => void) | undefined
  let markReadStarted: (() => void) | undefined
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve
  })
  const store = {
    ...backing,
    get: async (id: string) => {
      const stale = await backing.get(id)
      markReadStarted?.()
      await readGate
      return stale
    },
  } satisfies SurfaceStore
  let sourceStarts = 0
  const definition = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: filterSchema,
    event: changeSchema,
    subscribe: () => {
      sourceStarts += 1
      return (async function* () {})()
    },
  })
  const registry = new Genui({ actions: [], subscriptions: [definition], store })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const opening = registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "overlapping-revoke",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  await readStarted
  await registry.revoke(surface.id)
  releaseRead?.()

  const result = await opening
  assert.equal(result.ok ? undefined : result.error.code, "revoked")
  assert.equal(sourceStarts, 0)
  assert.equal(await backing.get(surface.id), undefined)
})

void test("an open started reentrantly during revocation cannot capture stale authority", async () => {
  const backing = memoryStore()
  let releaseRevoke: (() => void) | undefined
  let markRevokeStarted: (() => void) | undefined
  const revokeGate = new Promise<void>((resolve) => {
    releaseRevoke = resolve
  })
  const revokeStarted = new Promise<void>((resolve) => {
    markRevokeStarted = resolve
  })
  const store = {
    ...backing,
    revoke: async (id: string) => {
      markRevokeStarted?.()
      await revokeGate
      await backing.revoke(id)
    },
  } satisfies SurfaceStore
  const source = controlledSource()
  let sourceStarts = 0
  let surfaceId = ""
  let reentrantOpen: Promise<SubscriptionOpenResult> | undefined
  let registry: Genui<Readonly<Record<string, never>>> | undefined
  const definition = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: filterSchema,
    event: changeSchema,
    subscribe: (_ctx: Readonly<Record<string, never>>, _input, { signal }) => {
      sourceStarts += 1
      signal.addEventListener(
        "abort",
        () => {
          reentrantOpen = registry?.subscribe(
            {
              surfaceId,
              subscriptionId: "reentrant-open",
              subscription: definition.name,
              input: { status: "processing" },
            },
            {},
          )
        },
        { once: true },
      )
      return source.events
    },
  })
  registry = new Genui({ actions: [], subscriptions: [definition], store })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  surfaceId = surface.id
  const active = await registry.subscribe(
    {
      surfaceId,
      subscriptionId: "active-open",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  assert.equal(active.ok, true)

  const revoking = registry.revoke(surfaceId)
  await revokeStarted
  assert.notEqual(reentrantOpen, undefined)
  const reentrantResult = await reentrantOpen
  assert.equal(reentrantResult?.ok ? undefined : reentrantResult?.error.code, "revoked")
  assert.equal(sourceStarts, 1)
  releaseRevoke?.()
  await revoking
  assert.equal(await backing.get(surfaceId), undefined)
})

void test("a failed authoritative revoke leaves later opens fail closed until retry succeeds", async () => {
  const backing = memoryStore()
  let failRevocation = true
  const store = {
    ...backing,
    revoke: async (id: string) => {
      if (failRevocation) throw new Error("revoke store offline")
      await backing.revoke(id)
    },
  } satisfies SurfaceStore
  let sourceStarts = 0
  const definition = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: filterSchema,
    event: changeSchema,
    subscribe: () => {
      sourceStarts += 1
      return (async function* () {})()
    },
  })
  const registry = new Genui({ actions: [], subscriptions: [definition], store })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  await assert.rejects(registry.revoke(surface.id), /revoke store offline/)

  const blocked = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "after-failed-revoke",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  assert.equal(blocked.ok ? undefined : blocked.error.code, "revoked")
  assert.equal(sourceStarts, 0)

  failRevocation = false
  await registry.revoke(surface.id)
  assert.equal(await backing.get(surface.id), undefined)
})

void test("concurrent revocation tickets keep the guard until every attempt finishes", async () => {
  const backing = memoryStore()
  const releases: Array<() => void> = []
  const starts: Array<() => void> = []
  const gates = [
    new Promise<void>((resolve) => releases.push(resolve)),
    new Promise<void>((resolve) => releases.push(resolve)),
  ]
  const started = [
    new Promise<void>((resolve) => starts.push(resolve)),
    new Promise<void>((resolve) => starts.push(resolve)),
  ]
  let attempts = 0
  const store = {
    ...backing,
    revoke: async (id: string) => {
      const attempt = attempts
      attempts += 1
      starts[attempt]?.()
      await gates[attempt]
      if (attempt === 1) throw new Error("second revoke failed")
      await backing.revoke(id)
    },
  } satisfies SurfaceStore
  const definition = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  const registry = new Genui({ actions: [], subscriptions: [definition], store })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })

  const first = registry.revoke(surface.id)
  await started[0]
  const second = registry.revoke(surface.id)
  await started[1]
  releases[0]?.()
  await first

  const duringSecond = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "during-second-revoke",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  assert.equal(duringSecond.ok ? undefined : duringSecond.error.code, "revoked")

  releases[1]?.()
  await assert.rejects(second, /second revoke failed/)
  const afterAll = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "after-revokes",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  assert.equal(afterAll.ok ? undefined : afterAll.error.code, "unknown_surface")
})

void test("subscription terminates when per-event store reauthorization fails", async () => {
  const backing = memoryStore()
  let failReads = false
  const store = {
    ...backing,
    get: (id: string) => {
      if (failReads) throw new Error("store offline")
      return backing.get(id)
    },
  } satisfies SurfaceStore
  const source = controlledSource()
  const registry = new Genui({
    store,
    actions: [],
    subscriptions: [
      subscription({
        name: "orders.changes",
        description: "Receive order changes.",
        input: filterSchema,
        event: changeSchema,
        subscribe: () => source.events,
      }),
    ],
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: ["orders.changes"],
  })
  const result = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "subscription-1",
      subscription: "orders.changes",
      input: { status: "processing" },
    },
    {},
  )
  const next = openedEvents(result)[Symbol.asyncIterator]().next()
  failReads = true
  source.push({ id: "ord-1" })
  const delivery = await next
  assert.equal(
    delivery.done || delivery.value.type !== "error" ? undefined : delivery.value.error.code,
    "storage_unavailable",
  )
})

void test("subscription accepts function-valued AsyncIterables and iterators", async () => {
  let step = 0
  const iterator = function subscriptionIterator() {}
  Reflect.set(iterator, "next", async () => {
    step += 1
    return step === 1
      ? { done: false, value: { id: " ord-function " } }
      : { done: true, value: undefined }
  })
  const source = function subscriptionSource() {}
  Reflect.set(source, Symbol.asyncIterator, () => iterator)
  const definition = subscription({
    name: "orders.functions",
    description: "Function-valued source.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(definition, "subscribe", () => source)
  const registry = new Genui({ actions: [], subscriptions: [definition] })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const result = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "function-source",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const deliveries = openedEvents(result)[Symbol.asyncIterator]()
  assert.deepEqual(await deliveries.next(), {
    done: false,
    value: {
      type: "event",
      surfaceId: surface.id,
      subscriptionId: "function-source",
      sequence: 1,
      event: { id: "ord-function" },
    },
  })
  assert.deepEqual(await deliveries.next(), { done: true, value: undefined })
})

void test("subscription converts malformed iterator results and hostile getters to source failures", async () => {
  const doneCause = new Error("done getter exploded")
  const valueCause = new Error("value getter exploded")
  let doneReads = 0
  let valueReads = 0
  const hostileDone = {}
  Object.defineProperty(hostileDone, "done", {
    get: () => {
      doneReads += 1
      throw doneCause
    },
  })
  const hostileValue = {}
  Object.defineProperties(hostileValue, {
    done: {
      get: () => {
        doneReads += 1
        return false
      },
    },
    value: {
      get: () => {
        valueReads += 1
        throw valueCause
      },
    },
  })
  const results: unknown[] = [null, hostileDone, hostileValue]
  const sources = results.map((result) => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => result,
      return: async () => ({ done: true, value: undefined }),
    }),
  }))
  const failures: unknown[] = []
  const definition = subscription({
    name: "orders.iterator_results",
    description: "Iterator result boundary.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(definition, "subscribe", () => {
    const source = sources.shift()
    if (source === undefined) throw new Error("missing iterator-result source")
    return source
  })
  const registry = new Genui({
    actions: [],
    subscriptions: [definition],
    onError: (event) => {
      if (event.type === "subscription" && event.phase === "source_iteration") {
        failures.push(event.cause)
      }
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })

  for (let index = 0; index < results.length; index += 1) {
    const result = await registry.subscribe(
      {
        surfaceId: surface.id,
        subscriptionId: `malformed-result-${index}`,
        subscription: definition.name,
        input: { status: "processing" },
      },
      {},
    )
    const delivery = await openedEvents(result)[Symbol.asyncIterator]().next()
    assert.equal(
      delivery.done || delivery.value.type !== "error" ? undefined : delivery.value.error.code,
      "source_failed",
    )
  }
  assert.equal(failures[0] instanceof TypeError, true)
  assert.deepEqual(failures.slice(1), [doneCause, valueCause])
  assert.equal(doneReads, 2)
  assert.equal(valueReads, 1)
})

void test("subscription reads normal iterator-result getters only once", async () => {
  let doneReads = 0
  let valueReads = 0
  const eventResult = {}
  Object.defineProperties(eventResult, {
    done: {
      get: () => {
        doneReads += 1
        return false
      },
    },
    value: {
      get: () => {
        valueReads += 1
        return { id: " ord-1 " }
      },
    },
  })
  let nextCalls = 0
  const source = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        nextCalls += 1
        return nextCalls === 1 ? eventResult : { done: true, value: undefined }
      },
    }),
  }
  const definition = subscription({
    name: "orders.iterator_getters",
    description: "Iterator result getters.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(definition, "subscribe", () => source)
  const registry = new Genui({ actions: [], subscriptions: [definition] })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const result = await registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "getter-result",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const deliveries = openedEvents(result)[Symbol.asyncIterator]()
  const first = await deliveries.next()
  assert.deepEqual(first.done ? undefined : first.value, {
    type: "event",
    surfaceId: surface.id,
    subscriptionId: "getter-result",
    sequence: 1,
    event: { id: "ord-1" },
  })
  assert.deepEqual(await deliveries.next(), { done: true, value: undefined })
  assert.equal(doneReads, 1)
  assert.equal(valueReads, 1)
})

void test("subscription isolates throwing and rejected iterator cleanup", async () => {
  const throwingCleanup = new Error("return accessor exploded")
  const rejectedCleanup = new Error("return rejected")
  const cleanupErrors: unknown[] = []
  const sources = [
    (() => {
      const iterator = { next: () => new Promise<IteratorResult<unknown>>(() => undefined) }
      Object.defineProperty(iterator, "return", {
        get: () => {
          throw throwingCleanup
        },
      })
      return { [Symbol.asyncIterator]: () => iterator }
    })(),
    {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: () => Promise.reject(rejectedCleanup),
      }),
    },
  ]
  const definition = subscription({
    name: "orders.cleanup",
    description: "Cleanup source.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(definition, "subscribe", () => {
    const source = sources.shift()
    if (source === undefined) throw new Error("missing cleanup source")
    return source
  })
  const registry = new Genui({
    actions: [],
    subscriptions: [definition],
    onError: (event) => {
      if (event.type === "subscription" && event.phase === "cleanup") {
        cleanupErrors.push(event.cause)
      }
    },
  })
  const firstSurface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const first = await registry.subscribe(
    {
      surfaceId: firstSurface.id,
      subscriptionId: "throwing-return",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
  )
  const firstNext = openedEvents(first)[Symbol.asyncIterator]().next()
  await registry.revoke(firstSurface.id)
  const firstDelivery = await firstNext
  assert.equal(
    firstDelivery.done || firstDelivery.value.type !== "error"
      ? undefined
      : firstDelivery.value.error.code,
    "revoked",
  )

  const secondSurface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const controller = new AbortController()
  const second = await registry.subscribe(
    {
      surfaceId: secondSurface.id,
      subscriptionId: "rejected-return",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
    { signal: controller.signal },
  )
  const secondNext = openedEvents(second)[Symbol.asyncIterator]().next()
  controller.abort()
  assert.deepEqual(await secondNext, { done: true, value: undefined })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(cleanupErrors, [throwingCleanup, rejectedCleanup])
})

void test("late source startup cleanup isolates a hostile return accessor", async () => {
  const cleanupCause = new Error("late return accessor exploded")
  const cleanupErrors: unknown[] = []
  let markStarted: (() => void) | undefined
  let resolveSource: ((source: unknown) => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const startup = new Promise<unknown>((resolve) => {
    resolveSource = resolve
  })
  const definition = subscription({
    name: "orders.late",
    description: "Late source.",
    input: filterSchema,
    event: changeSchema,
    subscribe: async function* () {},
  })
  Reflect.set(definition, "subscribe", () => {
    markStarted?.()
    return startup
  })
  const registry = new Genui({
    actions: [],
    subscriptions: [definition],
    onError: (event) => {
      if (event.type === "subscription" && event.phase === "cleanup") {
        cleanupErrors.push(event.cause)
      }
    },
  })
  const surface = await registry.surface({
    content: "",
    actions: [],
    subscriptions: [definition.name],
  })
  const controller = new AbortController()
  const opening = registry.subscribe(
    {
      surfaceId: surface.id,
      subscriptionId: "late-source",
      subscription: definition.name,
      input: { status: "processing" },
    },
    {},
    { signal: controller.signal },
  )
  await started
  controller.abort()
  const result = await opening
  assert.equal(result.ok ? undefined : result.error.code, "source_failed")

  const iterator = { next: async () => ({ done: true, value: undefined }) }
  Object.defineProperty(iterator, "return", {
    get: () => {
      throw cleanupCause
    },
  })
  resolveSource?.({ [Symbol.asyncIterator]: () => iterator })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(cleanupErrors, [cleanupCause])
})
