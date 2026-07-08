import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
} from "./surface-broker.js"
import type { ActionCall, ActionResult } from "../types.js"
import {
  approvedDescriptor,
  diceDescriptor,
  sandboxCapabilityMessage,
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

void test("surface broker runs granted capability calls through transport", async () => {
  const current = testSurface([diceDescriptor])
  const calls: ActionCall[] = []
  const signals: AbortSignal[] = []
  const broker = createSurfaceBroker(current, {
    transport: async (call, options): Promise<ActionResult> => {
      calls.push(call)
      signals.push(options.signal)
      return { ok: true, value: { total: 6 } }
    },
  })

  const task = broker.handleSandboxMessage(sandboxCapabilityMessage(current))

  assert.deepEqual(emittedEvents(task.effects), [
    {
      type: "call",
      target: "rollResult",
      call: {
        surfaceId: current.id,
        callId: "call-1",
        action: "dice.roll",
        input: { sides: 6 },
      },
    },
  ])

  const effects = await pendingEffects(task)
  assert.deepEqual(calls, [
    { surfaceId: current.id, callId: "call-1", action: "dice.roll", input: { sides: 6 } },
  ])
  assert.equal(signals[0]?.aborted, false)
  assert.equal(resultPost(effects)?.type, "post_result")
  assert.deepEqual(emittedEvents(effects), [
    {
      type: "result",
      callId: "call-1",
      action: "dice.roll",
      target: "rollResult",
      result: { ok: true, value: { total: 6 } },
    },
  ])
})

void test("surface broker refuses ungranted capability calls before transport", () => {
  const current = testSurface([])
  let transportCalled = false
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => {
      transportCalled = true
      return { ok: true, value: {} }
    },
  })

  const task = broker.handleSandboxMessage(sandboxCapabilityMessage(current))

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

void test("surface broker denies approval-gated calls without approval", async () => {
  const current = testSurface([approvedDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(sandboxCapabilityMessage(current, "notes.create")),
  )
  const post = resultPost(effects)

  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "approval_denied",
  )
})

void test("surface broker approval is UX and authoritative transport denial still wins", async () => {
  const current = testSurface([approvedDescriptor])
  const brokerApprovals: ActionCall[] = []
  const transportCalls: ActionCall[] = []
  const broker = createSurfaceBroker(current, {
    confirm: (_descriptor, call) => {
      brokerApprovals.push(call)
      return true
    },
    transport: async (call): Promise<ActionResult> => {
      transportCalls.push(call)
      return {
        ok: false,
        error: { code: "approval_denied", message: "Capability was denied." },
      }
    },
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(sandboxCapabilityMessage(current, "notes.create")),
  )
  const post = resultPost(effects)

  assert.deepEqual(
    brokerApprovals.map((call) => call.callId),
    ["call-1"],
  )
  assert.deepEqual(
    transportCalls.map((call) => call.callId),
    ["call-1"],
  )
  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "approval_denied",
  )
})

void test("surface broker emits protocol, resize, link, and mismatch effects", () => {
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
        type: "link",
        surfaceId: current.id,
        href: "https://example.com/",
      }).effects,
    ),
    [{ type: "link", href: "https://example.com/" }],
  )
  assert.deepEqual(emittedEvents(broker.handleSandboxMessage({ channel: "wrong" }).effects), [
    { type: "violation", reason: "unknown_channel" },
  ])
  assert.deepEqual(emittedEvents(broker.handleSandboxMessage("bad").effects), [
    { type: "violation", reason: "bad_message" },
  ])
  assert.deepEqual(
    emittedEvents(
      broker.handleSandboxMessage({
        channel: protocolChannel,
        type: "resize",
        surfaceId: "other",
        height: 1,
      }).effects,
    ),
    [{ type: "violation", reason: "surface_mismatch" }],
  )
  assert.deepEqual(
    emittedEvents(
      broker.handleSandboxMessage({
        channel: protocolChannel,
        type: "violation",
        surfaceId: current.id,
        reason: "runtime_expression",
        detail: "data-genui-text: formatCurrency($amount, $currency)",
      }).effects,
    ),
    [
      {
        type: "violation",
        reason: "runtime_expression",
        detail: "data-genui-text: formatCurrency($amount, $currency)",
      },
    ],
  )
})

void test("surface broker refuses unsafe forged link messages", () => {
  const current = testSurface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<ActionResult> => ({ ok: true, value: {} }),
  })

  for (const href of ["javascript:alert(1)", "data:text/html,evil", "/internal", "http://x.test"]) {
    assert.deepEqual(
      emittedEvents(
        broker.handleSandboxMessage({
          channel: protocolChannel,
          type: "link",
          surfaceId: current.id,
          href,
        }).effects,
      ),
      [{ type: "violation", reason: "unsafe_link", detail: "Blocked unsafe link URL." }],
    )
  }
})

void test("surface broker aborts and drops pending results after replace or dispose", async () => {
  let resolveResult: ((result: ActionResult) => void) | undefined
  const result = new Promise<ActionResult>((resolve) => {
    resolveResult = resolve
  })
  const current = testSurface([diceDescriptor])
  const next = testSurface([diceDescriptor])
  let replaceSignal: AbortSignal | undefined
  const broker = createSurfaceBroker(current, {
    transport: async (_call, options) => {
      replaceSignal = options.signal
      return result
    },
  })

  const task = broker.handleSandboxMessage(sandboxCapabilityMessage(current))
  await Promise.resolve()
  assert.equal(replaceSignal?.aborted, false)
  broker.replace(next)
  assert.equal(replaceSignal?.aborted, true)
  resolveResult?.({ ok: true, value: { total: 6 } })

  assert.deepEqual(await pendingEffects(task), [])

  let disposeSignal: AbortSignal | undefined
  let resolveDisposedResult: ((result: ActionResult) => void) | undefined
  const disposedResult = new Promise<ActionResult>((resolve) => {
    resolveDisposedResult = resolve
  })
  const disposed = testSurface([diceDescriptor])
  const disposedBroker = createSurfaceBroker(disposed, {
    transport: async (_call, options): Promise<ActionResult> => {
      disposeSignal = options.signal
      return disposedResult
    },
  })
  const disposedTask = disposedBroker.handleSandboxMessage(sandboxCapabilityMessage(disposed))
  await Promise.resolve()
  assert.equal(disposeSignal?.aborted, false)
  disposedBroker.dispose()
  assert.equal(disposeSignal?.aborted, true)
  resolveDisposedResult?.({ ok: true, value: { total: 6 } })

  assert.deepEqual(await pendingEffects(disposedTask), [])
})
