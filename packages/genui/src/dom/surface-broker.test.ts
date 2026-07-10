import assert from "node:assert/strict"
import { test } from "node:test"
import type { ActionCall, ActionResult } from "../protocol/index.js"
import type { SendMessageParams } from "./host-capabilities.js"
import { protocolChannel } from "./protocol.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
} from "./surface-broker.js"
import {
  approvedDescriptor,
  deferred,
  diceDescriptor,
  sandboxActionMessage,
  testSurface,
} from "./test-support.test-support.js"

const pendingEffects = async (task: SurfaceBrokerTask): Promise<readonly SurfaceBrokerEffect[]> => {
  assert.notEqual(task.pending, undefined)
  return task.pending ?? []
}

const emittedEvents = (effects: readonly SurfaceBrokerEffect[]): unknown[] =>
  effects.flatMap((effect) => (effect.type === "emit" ? [effect.event] : []))

const resultPost = (effects: readonly SurfaceBrokerEffect[]): SurfaceBrokerEffect | undefined =>
  effects.find((effect) => effect.type === "post_result")

const capabilityResultPost = (
  effects: readonly SurfaceBrokerEffect[],
): SurfaceBrokerEffect | undefined =>
  effects.find((effect) => effect.type === "post_capability_result")

void test("surface broker runs granted code calls through transport", async () => {
  const current = testSurface([diceDescriptor])
  const calls: ActionCall[] = []
  const broker = createSurfaceBroker(current, {
    transport: async (call): Promise<ActionResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
  })

  const task = broker.handleSandboxMessage(sandboxActionMessage(current))
  assert.deepEqual(emittedEvents(task.effects), [
    {
      type: "call",
      call: {
        surfaceId: current.id,
        callId: "call-1",
        action: "dice.roll",
        input: { sides: 6 },
      },
    },
  ])

  const effects = await pendingEffects(task)
  assert.equal(calls.length, 1)
  assert.deepEqual(resultPost(effects), {
    type: "post_result",
    message: {
      channel: protocolChannel,
      type: "result",
      surfaceId: current.id,
      callId: "call-1",
      action: "dice.roll",
      result: { ok: true, value: { total: 6 } },
    },
  })
})

void test("surface broker delivers send-message capability requests", async () => {
  const current = testSurface([])
  let received: SendMessageParams | undefined
  const broker = createSurfaceBroker(current, {
    capabilities: {
      sendMessage: async (params) => {
        received = params
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const request = {
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: current.id,
    callId: "capability-1",
    capability: "ui/message",
    params: {
      role: "user",
      content: { type: "text", text: "Show the selected orders" },
    },
  } as const

  const capabilityTask = broker.handleSandboxMessage(request)
  assert.deepEqual(emittedEvents(capabilityTask.effects), [
    {
      type: "capability_call",
      call: {
        surfaceId: current.id,
        callId: "capability-1",
        capability: "sendMessage",
      },
      payloadBytes: 24,
    },
  ])

  const effects = await pendingEffects(capabilityTask)
  assert.deepEqual(received, request.params)
  assert.deepEqual(capabilityResultPost(effects), {
    type: "post_capability_result",
    message: {
      channel: protocolChannel,
      type: "result",
      surfaceId: current.id,
      callId: "capability-1",
      action: "ui/message",
      result: { ok: true, value: {} },
    },
  })
  assert.deepEqual(emittedEvents(effects), [
    {
      type: "capability_result",
      callId: "capability-1",
      capability: "sendMessage",
      outcome: "ok",
    },
  ])
})

void test("surface broker permits only absolute HTTPS links", async () => {
  const current = testSurface([])
  const opened: string[] = []
  const broker = createSurfaceBroker(current, {
    capabilities: {
      openLink: async ({ url }) => {
        opened.push(url)
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  for (const [index, url] of [
    "https://example.com/orders/42",
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,hello",
    "/relative",
    "not a URL",
  ].entries()) {
    const capabilityTask = broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId: `link-${index}`,
      capability: "ui/open-link",
      params: { url },
    })
    const effects =
      capabilityTask.pending === undefined
        ? capabilityTask.effects
        : await pendingEffects(capabilityTask)
    const post = capabilityResultPost(effects)
    assert.equal(
      post?.type === "post_capability_result" && post.message.result.ok === false
        ? post.message.result.error.code
        : "ok",
      index === 0 ? "ok" : "invalid_input",
    )
  }

  assert.deepEqual(opened, ["https://example.com/orders/42"])
})

void test("surface broker enforces the 16 KiB send-message boundary", async () => {
  const current = testSurface([])
  const received: string[] = []
  const broker = createSurfaceBroker(current, {
    capabilities: {
      sendMessage: async ({ content }) => {
        received.push(content.text)
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const exactText = "é".repeat(8 * 1_024)
  const message = (callId: string, text: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/message",
      params: { role: "user", content: { type: "text", text } },
    }) as const

  await pendingEffects(broker.handleSandboxMessage(message("exact", exactText)))
  const oversized = broker.handleSandboxMessage(message("oversized", `${exactText}a`))
  const post = capabilityResultPost(oversized.effects)

  assert.equal(
    post?.type === "post_capability_result" && post.message.result.ok === false
      ? post.message.result.error.code
      : undefined,
    "invalid_input",
  )
  assert.deepEqual(received, [exactText])
})

void test("surface broker permits one in-flight request per host capability", async () => {
  const current = testSurface([])
  const gate = deferred<void>()
  let handlerCalls = 0
  const broker = createSurfaceBroker(current, {
    capabilities: {
      sendMessage: async () => {
        handlerCalls += 1
        await gate.promise
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const message = (callId: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/message",
      params: { role: "user", content: { type: "text", text: callId } },
    }) as const

  const first = broker.handleSandboxMessage(message("first"))
  await Promise.resolve()
  const second = broker.handleSandboxMessage(message("second"))
  const secondPost = capabilityResultPost(second.effects)

  assert.equal(handlerCalls, 1)
  assert.equal(second.pending, undefined)
  assert.equal(
    secondPost?.type === "post_capability_result" && secondPost.message.result.ok === false
      ? secondPost.message.result.error.code
      : undefined,
    "rate_limited",
  )

  gate.resolve(undefined)
  await pendingEffects(first)
})

void test("surface broker enforces the 16 KiB model-context boundary", async () => {
  const current = testSurface([])
  const received: unknown[] = []
  const broker = createSurfaceBroker(current, {
    capabilities: {
      updateModelContext: async (params) => {
        received.push(params)
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const exactContent = "a".repeat(16 * 1_024 - 14)
  const message = (callId: string, content: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/update-model-context",
      params: { content },
    }) as const

  assert.equal(
    new TextEncoder().encode(JSON.stringify({ content: exactContent })).byteLength,
    16 * 1_024,
  )
  await pendingEffects(broker.handleSandboxMessage(message("exact", exactContent)))
  const oversized = broker.handleSandboxMessage(message("oversized", `${exactContent}a`))
  const post = capabilityResultPost(oversized.effects)

  assert.equal(
    post?.type === "post_capability_result" && post.message.result.ok === false
      ? post.message.result.error.code
      : undefined,
    "invalid_input",
  )
  assert.deepEqual(received, [{ content: exactContent }])
})

void test("surface broker queues only the latest model-context update", async () => {
  const current = testSurface([])
  const firstGate = deferred<void>()
  const latestGate = deferred<void>()
  const received: string[] = []
  const broker = createSurfaceBroker(current, {
    capabilities: {
      updateModelContext: async ({ content }) => {
        received.push(content ?? "")
        if (content === "first") await firstGate.promise
        if (content === "latest") await latestGate.promise
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const message = (callId: string, content: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/update-model-context",
      params: { content },
    }) as const

  const first = broker.handleSandboxMessage(message("first", "first"))
  await Promise.resolve()
  const superseded = broker.handleSandboxMessage(message("waiting", "waiting"))
  const latest = broker.handleSandboxMessage(message("latest", "latest"))

  assert.deepEqual(received, ["first"])
  const supersededEffects = await pendingEffects(superseded)
  assert.deepEqual(capabilityResultPost(supersededEffects), {
    type: "post_capability_result",
    message: {
      channel: protocolChannel,
      type: "result",
      surfaceId: current.id,
      callId: "waiting",
      action: "ui/update-model-context",
      result: { ok: true, value: {} },
    },
  })
  assert.deepEqual(emittedEvents(supersededEffects), [
    {
      type: "capability_result",
      callId: "waiting",
      capability: "updateModelContext",
      outcome: "superseded",
    },
  ])

  firstGate.resolve(undefined)
  await pendingEffects(first)
  await Promise.resolve()
  assert.deepEqual(received, ["first", "latest"])

  latestGate.resolve(undefined)
  assert.deepEqual(emittedEvents(await pendingEffects(latest)), [
    {
      type: "capability_result",
      callId: "latest",
      capability: "updateModelContext",
      outcome: "ok",
    },
  ])
})

void test("surface broker reports unavailable and denied capability outcomes", async () => {
  const current = testSurface([])
  const unavailableBroker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const unavailable = unavailableBroker.handleSandboxMessage({
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: current.id,
    callId: "unavailable",
    capability: "ui/message",
    params: { role: "user", content: { type: "text", text: "Hello" } },
  })
  assert.deepEqual(emittedEvents(unavailable.effects).at(-1), {
    type: "capability_result",
    callId: "unavailable",
    capability: "sendMessage",
    outcome: "not_available",
  })

  const deniedBroker = createSurfaceBroker(current, {
    capabilities: {
      openLink: async () => {
        throw new Error("User declined")
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const denied = await pendingEffects(
    deniedBroker.handleSandboxMessage({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId: "denied",
      capability: "ui/open-link",
      params: { url: "https://example.com" },
    }),
  )
  assert.deepEqual(emittedEvents(denied), [
    {
      type: "capability_result",
      callId: "denied",
      capability: "openLink",
      outcome: "denied",
    },
  ])
})

void test("surface broker reports guest errors and applies the default resize policy", () => {
  const current = testSurface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  assert.deepEqual(
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: current.id,
      width: 640,
      height: 1_400,
    }).effects,
    [
      { type: "set_width", width: undefined },
      { type: "set_height", height: 1_200 },
      { type: "emit", event: { type: "resize", width: 640, height: 1_200 } },
    ],
  )
  assert.deepEqual(
    emittedEvents(
      broker.handleSandboxMessage({
        channel: protocolChannel,
        type: "guest_error",
        surfaceId: current.id,
        message: "Guest failed",
        stack: "guest.js:1",
      }).effects,
    ),
    [{ type: "guest_error", message: "Guest failed", stack: "guest.js:1" }],
  )
})

void test("surface broker applies independent fixed and flexible resize axes", () => {
  const current = testSurface([])
  const cases = [
    {
      dimensions: { width: 400, height: 300 },
      width: 400,
      height: 300,
    },
    {
      dimensions: { width: 400, maxHeight: 500 },
      width: 400,
      height: 500,
    },
    {
      dimensions: { maxWidth: 600, height: 300 },
      width: 600,
      height: 300,
    },
    {
      dimensions: { maxWidth: 600, maxHeight: 500 },
      width: 600,
      height: 500,
    },
    {
      dimensions: { maxWidth: 1_000, maxHeight: 1_000 },
      width: 800,
      height: 900,
    },
    {
      dimensions: { maxWidth: 0, maxHeight: 0 },
      width: 0,
      height: 0,
    },
  ] as const

  for (const { dimensions, width, height } of cases) {
    const broker = createSurfaceBroker(current, {
      containerDimensions: dimensions,
      transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
    })

    assert.deepEqual(
      broker.handleSandboxMessage({
        channel: protocolChannel,
        type: "resize",
        surfaceId: current.id,
        width: 800,
        height: 900,
      }).effects,
      [
        { type: "set_width", width },
        { type: "set_height", height },
        { type: "emit", event: { type: "resize", width, height } },
      ],
    )
  }
})

void test("surface broker reapplies live dimension policy to the latest report", () => {
  const current = testSurface([])
  const broker = createSurfaceBroker(current, {
    containerDimensions: { width: 400, height: 300 },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  broker.handleSandboxMessage({
    channel: protocolChannel,
    type: "resize",
    surfaceId: current.id,
    width: 800,
    height: 900,
  })

  assert.deepEqual(broker.updateContainerDimensions({ maxWidth: 500 }).effects, [
    { type: "set_width", width: undefined },
    { type: "set_height", height: 900 },
  ])
  assert.deepEqual(
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: current.id,
      width: 450,
      height: 1_500,
    }).effects,
    [
      { type: "set_width", width: 450 },
      { type: "set_height", height: 1_200 },
      { type: "emit", event: { type: "resize", width: 450, height: 1_200 } },
    ],
  )
  assert.deepEqual(broker.updateContainerDimensions({}).effects, [
    { type: "set_width", width: undefined },
    { type: "set_height", height: 1_200 },
  ])
})

void test("surface broker releases flexible width before probing a larger maximum", () => {
  const current = testSurface([])
  const broker = createSurfaceBroker(current, {
    containerDimensions: { maxWidth: 300 },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  broker.handleSandboxMessage({
    channel: protocolChannel,
    type: "resize",
    surfaceId: current.id,
    width: 800,
    height: 200,
  })
  broker.handleSandboxMessage({
    channel: protocolChannel,
    type: "resize",
    surfaceId: current.id,
    width: 300,
    height: 200,
  })

  assert.deepEqual(broker.updateContainerDimensions({ maxWidth: 600 }).effects, [
    { type: "set_width", width: undefined },
    { type: "set_height", height: 200 },
  ])
  assert.deepEqual(
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: current.id,
      width: 600,
      height: 200,
    }).effects,
    [
      { type: "set_width", width: 600 },
      { type: "set_height", height: 200 },
      { type: "emit", event: { type: "resize", width: 600, height: 200 } },
    ],
  )
})

void test("surface broker resets resize state across replacement and disposal", () => {
  const first = testSurface([])
  const second = testSurface([])
  const broker = createSurfaceBroker(first, {
    containerDimensions: { width: 320, maxHeight: 500 },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  assert.deepEqual(broker.updateContainerDimensions({ width: 320, maxHeight: 500 }).effects, [
    { type: "set_width", width: 320 },
    { type: "set_height", height: undefined },
  ])
  broker.handleSandboxMessage({
    channel: protocolChannel,
    type: "resize",
    surfaceId: first.id,
    width: 800,
    height: 900,
  })

  broker.replace(second)
  assert.deepEqual(broker.updateContainerDimensions({}).effects, [
    { type: "set_width", width: undefined },
    { type: "set_height", height: undefined },
  ])
  assert.deepEqual(
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: first.id,
      width: 100,
      height: 100,
    }).effects,
    [],
  )

  broker.dispose()
  assert.deepEqual(broker.updateContainerDimensions({ width: 10, height: 10 }).effects, [])
})

void test("red team: ungranted calls return not_granted without transport", () => {
  const current = testSurface([])
  let transportCalled = false
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => {
      transportCalled = true
      return { ok: true, value: {} }
    },
  })

  const task = broker.handleSandboxMessage(sandboxActionMessage(current))
  assert.equal(task.pending, undefined)
  assert.equal(transportCalled, false)
  assert.deepEqual(
    emittedEvents(task.effects).map((event) =>
      typeof event === "object" && event !== null && "type" in event ? event.type : undefined,
    ),
    ["violation", "result"],
  )
  const post = resultPost(task.effects)
  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "not_granted",
  )
})

void test("surface broker confirms authoritative approval intent and retries once", async () => {
  const current = testSurface([approvedDescriptor])
  const calls: ActionCall[] = []
  let confirmedIntent: string | undefined
  const broker = createSurfaceBroker(current, {
    confirm: (_action, _call, intent) => {
      confirmedIntent = intent
      return true
    },
    transport: async (call): Promise<ActionResult> => {
      calls.push(call)
      return calls.length === 1
        ? {
            ok: false,
            error: { code: "approval_required", message: "Create note hello" },
          }
        : { ok: true, value: { created: true } }
    },
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(sandboxActionMessage(current, "notes.create")),
  )
  assert.equal(confirmedIntent, "Create note hello")
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  const post = resultPost(effects)
  assert.deepEqual(post?.type === "post_result" ? post.message.result : undefined, {
    ok: true,
    value: { created: true },
  })
})

void test("surface broker turns declined authoritative approval into a denial", async () => {
  const current = testSurface([approvedDescriptor])
  let transportCalls = 0
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => {
      transportCalls += 1
      return {
        ok: false,
        error: { code: "approval_required", message: "Create a note" },
      }
    },
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(sandboxActionMessage(current, "notes.create")),
  )
  const post = resultPost(effects)
  assert.equal(transportCalls, 1)
  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "approval_denied",
  )
})

void test("surface broker does not prompt for a terminal transport result", async () => {
  const current = testSurface([approvedDescriptor])
  let confirmations = 0
  const broker = createSurfaceBroker(current, {
    confirm: () => {
      confirmations += 1
      return true
    },
    transport: async (): Promise<ActionResult> => ({
      ok: false,
      error: { code: "approval_denied", message: "Kernel denied the action." },
    }),
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(sandboxActionMessage(current, "notes.create")),
  )
  const post = resultPost(effects)
  assert.equal(confirmations, 0)
  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "approval_denied",
  )
})

void test("surface broker rejects malformed transport results", async () => {
  const current = testSurface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async () => JSON.parse(`{"ok":"yes"}`),
  })

  const post = resultPost(
    await pendingEffects(broker.handleSandboxMessage(sandboxActionMessage(current))),
  )
  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "execution_failed",
  )
})

void test("surface broker aborts and drops pending work after replace", async () => {
  let resolveResult: ((result: ActionResult) => void) | undefined
  const result = new Promise<ActionResult>((resolve) => {
    resolveResult = resolve
  })
  const current = testSurface([diceDescriptor])
  const next = testSurface([diceDescriptor])
  let signal: AbortSignal | undefined
  const broker = createSurfaceBroker(current, {
    transport: async (_call, options) => {
      signal = options.signal
      return result
    },
  })

  const task = broker.handleSandboxMessage(sandboxActionMessage(current))
  await Promise.resolve()
  assert.equal(signal?.aborted, false)
  broker.replace(next)
  assert.equal(signal?.aborted, true)
  resolveResult?.({ ok: true, value: {} })
  assert.deepEqual(await pendingEffects(task), [])
})

void test("surface broker drops capability work after replace and dispose", async () => {
  const current = testSurface([])
  const next = testSurface([])
  const oldGate = deferred<void>()
  const newGate = deferred<void>()
  const broker = createSurfaceBroker(current, {
    capabilities: {
      sendMessage: async ({ content }) => {
        if (content.text === "old") await oldGate.promise
        if (content.text === "new") await newGate.promise
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const message = (surfaceId: string, callId: string, text: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId,
      callId,
      capability: "ui/message",
      params: { role: "user", content: { type: "text", text } },
    }) as const

  const oldRequest = broker.handleSandboxMessage(message(current.id, "old", "old"))
  await Promise.resolve()
  broker.replace(next)
  assert.deepEqual(broker.handleSandboxMessage(message(current.id, "stale", "stale")).effects, [])

  const newRequest = broker.handleSandboxMessage(message(next.id, "new", "new"))
  await Promise.resolve()
  oldGate.resolve(undefined)
  const staleEffects = await pendingEffects(oldRequest)
  assert.equal(capabilityResultPost(staleEffects), undefined)
  assert.deepEqual(emittedEvents(staleEffects), [
    {
      type: "capability_result",
      callId: "old",
      capability: "sendMessage",
      outcome: "ok",
    },
  ])

  const rateLimited = broker.handleSandboxMessage(message(next.id, "third", "third"))
  const rateLimitedPost = capabilityResultPost(rateLimited.effects)
  assert.equal(
    rateLimitedPost?.type === "post_capability_result" &&
      rateLimitedPost.message.result.ok === false
      ? rateLimitedPost.message.result.error.code
      : undefined,
    "rate_limited",
  )
  newGate.resolve(undefined)
  await pendingEffects(newRequest)

  const disposeGate = deferred<void>()
  const disposable = createSurfaceBroker(current, {
    capabilities: { openLink: async () => await disposeGate.promise },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const pendingDispose = disposable.handleSandboxMessage({
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: current.id,
    callId: "dispose",
    capability: "ui/open-link",
    params: { url: "https://example.com" },
  })
  await Promise.resolve()
  disposable.dispose()
  disposeGate.resolve(undefined)
  assert.deepEqual(await pendingEffects(pendingDispose), [])
})

void test("surface broker drops a queued model-context update on replacement", async () => {
  const current = testSurface([])
  const next = testSurface([])
  const gate = deferred<void>()
  const broker = createSurfaceBroker(current, {
    capabilities: {
      updateModelContext: async () => await gate.promise,
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const message = (callId: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/update-model-context",
      params: { content: callId },
    }) as const

  const active = broker.handleSandboxMessage(message("active"))
  await Promise.resolve()
  const queued = broker.handleSandboxMessage(message("queued"))

  broker.replace(next)
  const queuedEffects = await pendingEffects(queued)
  assert.equal(capabilityResultPost(queuedEffects), undefined)
  assert.deepEqual(emittedEvents(queuedEffects), [
    {
      type: "capability_result",
      callId: "queued",
      capability: "updateModelContext",
      outcome: "superseded",
    },
  ])
  gate.resolve(undefined)
  const activeEffects = await pendingEffects(active)
  assert.equal(capabilityResultPost(activeEffects), undefined)
  assert.deepEqual(emittedEvents(activeEffects), [
    {
      type: "capability_result",
      callId: "active",
      capability: "updateModelContext",
      outcome: "ok",
    },
  ])
})

void test("same-surface replacement preserves the per-capability in-flight limit", async () => {
  const current = testSurface([])
  const replacement = { ...current, content: "<p>Replacement</p>" }
  const gate = deferred<void>()
  let handlerCalls = 0
  const broker = createSurfaceBroker(current, {
    capabilities: {
      sendMessage: async ({ content }) => {
        handlerCalls += 1
        if (content.text === "old") await gate.promise
      },
    },
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })
  const message = (callId: string, text: string) =>
    ({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: current.id,
      callId,
      capability: "ui/message",
      params: { role: "user", content: { type: "text", text } },
    }) as const

  const old = broker.handleSandboxMessage(message("old", "old"))
  await Promise.resolve()
  broker.replace(replacement)
  const overlapping = broker.handleSandboxMessage(message("overlapping", "overlapping"))
  const overlapPost = capabilityResultPost(overlapping.effects)

  assert.equal(handlerCalls, 1)
  assert.equal(
    overlapPost?.type === "post_capability_result" && overlapPost.message.result.ok === false
      ? overlapPost.message.result.error.code
      : undefined,
    "rate_limited",
  )

  gate.resolve(undefined)
  const oldEffects = await pendingEffects(old)
  assert.equal(capabilityResultPost(oldEffects), undefined)
  assert.deepEqual(emittedEvents(oldEffects), [
    {
      type: "capability_result",
      callId: "old",
      capability: "sendMessage",
      outcome: "ok",
    },
  ])
  await pendingEffects(broker.handleSandboxMessage(message("new", "new")))
  assert.equal(handlerCalls, 2)
})
