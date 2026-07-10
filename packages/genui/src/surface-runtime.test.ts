import assert from "node:assert/strict"
import { test } from "node:test"
import type { Policy } from "./protocol/index.js"
import { createSurfaceRuntime } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { AnyActionDefinition } from "./types.js"
import type { AnySubscriptionDefinition } from "./types.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "input must be an object." },
)

const actionDefinition = (name: string, policy?: Policy): AnyActionDefinition<unknown> => ({
  name,
  description: `${name} test action.`,
  effect: policy === "block" ? "dangerous" : "read",
  policy,
  input: emptyInput,
  execute: () => ({}),
})

const subscriptionDefinition = (
  name: string,
  policy?: "allow" | "block",
): AnySubscriptionDefinition<unknown> => ({
  name,
  description: `${name} test subscription.`,
  policy,
  input: emptyInput,
  inputJsonSchema: { type: "object", properties: { filter: { type: "string" } } },
  event: emptyInput,
  eventJsonSchema: { type: "object", properties: { value: { type: "string" } } },
  subscribe: async function* () {},
})

void test("surface runtime preserves code and owns grant records and diagnostics", async () => {
  const runtime = createSurfaceRuntime({
    byName: new Map([
      ["dice.roll", actionDefinition("dice.roll")],
      ["demo.blocked", actionDefinition("demo.blocked", "block")],
    ]),
  })
  const source = {
    content: `<button>Roll</button><script type="module">genui.call("dice.roll", {})</script>`,
    actions: ["dice.roll", "missing.action", "dice.roll", "demo.blocked"],
    meta: { origin: "test" },
  }
  const surface = await runtime.surface(source)
  const record = await runtime.getRecord(surface.id)

  assert.equal(surface.content, source.content)
  assert.deepEqual(
    surface.grant.actions.map((action) => action.name),
    ["dice.roll"],
  )
  assert.deepEqual(record?.source, source)
  assert.deepEqual(record?.diagnostics, {
    actions: source.actions,
    granted: ["dice.roll"],
    dropped: [
      { name: "missing.action", reason: "unknown" },
      { name: "dice.roll", reason: "duplicate" },
      { name: "demo.blocked", reason: "blocked" },
    ],
    subscriptions: [],
    grantedSubscriptions: [],
    droppedSubscriptions: [],
  })
})

void test("surface runtime reprojects authority without rewriting source", async () => {
  const byName = new Map<string, AnyActionDefinition<unknown>>([
    ["dice.roll", actionDefinition("dice.roll")],
  ])
  const runtime = createSurfaceRuntime({ byName })
  const source = {
    content: `<button>Roll</button><script type="module">genui.call("dice.roll", {})</script>`,
    actions: ["dice.roll"],
    subject: "session-1",
  }
  const created = await runtime.surface(source)

  byName.set("dice.roll", actionDefinition("dice.roll", "block"))
  const reprojected = await runtime.reprojectSurface(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.equal(reprojected?.content, source.content)
  assert.equal(reprojected?.grant.subject, "session-1")
  assert.equal((await runtime.getRecord(created.id))?.subject, "session-1")
  assert.deepEqual(reprojected?.grant.actions, [])
  assert.deepEqual(await runtime.diagnostics(created.id), {
    actions: ["dice.roll"],
    granted: [],
    dropped: [{ name: "dice.roll", reason: "blocked" }],
    subscriptions: [],
    grantedSubscriptions: [],
    droppedSubscriptions: [],
  })
})

void test("surface runtime persists and reprojects separate subscription authority", async () => {
  const allowed = subscriptionDefinition("orders.changes")
  const blocked = subscriptionDefinition("orders.blocked", "block")
  const byName = new Map<string, AnySubscriptionDefinition<unknown>>([
    [allowed.name, allowed],
    [blocked.name, blocked],
  ])
  const runtime = createSurfaceRuntime({
    byName: new Map(),
    subscriptionsByName: byName,
  })
  const created = await runtime.surface({
    content: "<p>Orders</p>",
    actions: [],
    subscriptions: [allowed.name, "orders.missing", allowed.name, blocked.name],
  })

  assert.deepEqual(
    created.grant.subscriptions.map((item) => item.name),
    [allowed.name],
  )
  assert.deepEqual(await runtime.diagnostics(created.id), {
    actions: [],
    granted: [],
    dropped: [],
    subscriptions: [allowed.name, "orders.missing", allowed.name, blocked.name],
    grantedSubscriptions: [allowed.name],
    droppedSubscriptions: [
      { name: "orders.missing", reason: "unknown" },
      { name: allowed.name, reason: "duplicate" },
      { name: blocked.name, reason: "blocked" },
    ],
  })

  const returned = created.grant.subscriptions[0]
  assert.notEqual(returned, undefined)
  if (returned === undefined) return
  Reflect.set(returned.inputSchema ?? {}, "forged", true)
  Reflect.set(returned.eventSchema ?? {}, "forged", true)
  const stored = await runtime.getRecord(created.id)
  assert.equal(stored?.surface.grant.subscriptions[0]?.inputSchema?.forged, undefined)
  assert.equal(stored?.surface.grant.subscriptions[0]?.eventSchema?.forged, undefined)

  byName.set(allowed.name, subscriptionDefinition(allowed.name, "block"))
  const reprojected = await runtime.reprojectSurface(created.id)
  assert.deepEqual(reprojected?.grant.subscriptions, [])
})

void test("surface runtime accepts only the shipped dialect", async () => {
  const runtime = createSurfaceRuntime({ byName: new Map() })
  await assert.rejects(
    runtime.surface({ dialect: "code/1", content: "", actions: [] }),
    /Unsupported generated UI dialect: code\/1/,
  )
})
