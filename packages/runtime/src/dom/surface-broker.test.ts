import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
} from "./surface-broker.js"
import type { CapabilityCall, CapabilityResult, Surface } from "../types.js"

const diceDescriptor = {
  name: "dice.roll",
  description: "Roll a die.",
  effect: "read",
  requiresApproval: false,
} as const

const approvedDescriptor = {
  name: "notes.create",
  description: "Create a note.",
  effect: "write",
  requiresApproval: true,
} as const

const surface = (capabilities: Surface["grant"]["capabilities"]): Surface => {
  const id = globalThis.crypto.randomUUID()
  return {
    id,
    html: "",
    grant: { surfaceId: id, capabilities },
    dialect: "genui/0",
  }
}

const capabilityMessage = (
  current: Surface,
  capability = "dice.roll",
): Readonly<Record<string, unknown>> => ({
  channel: protocolChannel,
  type: "capability",
  surfaceId: current.id,
  callId: "call-1",
  capability,
  input: { sides: 6 },
  target: "rollResult",
})

const pendingEffects = async (task: SurfaceBrokerTask): Promise<readonly SurfaceBrokerEffect[]> => {
  assert.notEqual(task.pending, undefined)
  return task.pending ?? []
}

const emittedEvents = (effects: readonly SurfaceBrokerEffect[]): unknown[] =>
  effects.flatMap((effect) => (effect.type === "emit" ? [effect.event] : []))

const resultPost = (effects: readonly SurfaceBrokerEffect[]): SurfaceBrokerEffect | undefined =>
  effects.find((effect) => effect.type === "post_result")

void test("surface broker runs granted capability calls through transport", async () => {
  const current = surface([diceDescriptor])
  const calls: CapabilityCall[] = []
  const broker = createSurfaceBroker(current, {
    transport: async (call): Promise<CapabilityResult> => {
      calls.push(call)
      return { ok: true, value: { total: 6 } }
    },
  })

  const task = broker.handleSandboxMessage(capabilityMessage(current))

  assert.deepEqual(emittedEvents(task.effects), [
    {
      type: "call",
      target: "rollResult",
      call: {
        surfaceId: current.id,
        callId: "call-1",
        capability: "dice.roll",
        input: { sides: 6 },
      },
    },
  ])

  const effects = await pendingEffects(task)
  assert.deepEqual(calls, [
    { surfaceId: current.id, callId: "call-1", capability: "dice.roll", input: { sides: 6 } },
  ])
  assert.equal(resultPost(effects)?.type, "post_result")
  assert.deepEqual(emittedEvents(effects), [
    {
      type: "result",
      callId: "call-1",
      capability: "dice.roll",
      target: "rollResult",
      result: { ok: true, value: { total: 6 } },
    },
  ])
})

void test("surface broker refuses ungranted capability calls before transport", () => {
  const current = surface([])
  let transportCalled = false
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<CapabilityResult> => {
      transportCalled = true
      return { ok: true, value: {} }
    },
  })

  const task = broker.handleSandboxMessage(capabilityMessage(current))

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
  const current = surface([approvedDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
  })

  const effects = await pendingEffects(
    broker.handleSandboxMessage(capabilityMessage(current, "notes.create")),
  )
  const post = resultPost(effects)

  assert.equal(
    post?.type === "post_result" && !post.message.result.ok
      ? post.message.result.error.code
      : undefined,
    "approval_denied",
  )
})

void test("surface broker emits protocol, resize, link, and mismatch effects", () => {
  const current = surface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    maxHeight: 320,
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
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
})

void test("surface broker refuses unsafe forged link messages", () => {
  const current = surface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: {} }),
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

void test("surface broker drops pending results after update or dispose", async () => {
  let resolveResult: ((result: CapabilityResult) => void) | undefined
  const result = new Promise<CapabilityResult>((resolve) => {
    resolveResult = resolve
  })
  const current = surface([diceDescriptor])
  const next = surface([diceDescriptor])
  const broker = createSurfaceBroker(current, {
    transport: async () => result,
  })

  const task = broker.handleSandboxMessage(capabilityMessage(current))
  broker.update(next)
  resolveResult?.({ ok: true, value: { total: 6 } })

  assert.deepEqual(await pendingEffects(task), [])

  const disposed = surface([diceDescriptor])
  const disposedBroker = createSurfaceBroker(disposed, {
    transport: async (): Promise<CapabilityResult> => ({ ok: true, value: { total: 6 } }),
  })
  const disposedTask = disposedBroker.handleSandboxMessage(capabilityMessage(disposed))
  disposedBroker.dispose()

  assert.deepEqual(await pendingEffects(disposedTask), [])
})
