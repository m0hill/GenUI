import assert from "node:assert/strict"
import { test } from "node:test"
import type { ActionCall, ActionResult } from "@genui/protocol"
import { protocolChannel } from "./protocol.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
} from "./surface-broker.js"
import {
  approvedDescriptor,
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

void test("surface broker reports guest errors and clamps resize", () => {
  const current = testSurface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    maxHeight: 320,
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  assert.deepEqual(
    broker.handleSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: current.id,
      height: 999,
    }).effects,
    [
      { type: "set_height", height: 320 },
      { type: "emit", event: { type: "resize", height: 320 } },
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
