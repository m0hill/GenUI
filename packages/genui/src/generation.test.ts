import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui, subscription } from "./registry.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "object required" },
)

const searchInput = testSchema<Readonly<{ status?: "open" | "shipped" }>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "object required" },
)

const searchOutput = testSchema<Readonly<{ ids: readonly string[] }>>((value) =>
  isRecord(value) ? { ok: true, value: { ids: [] } } : { ok: false, message: "object required" },
)

const changeEvent = testSchema<Readonly<{ id: string }>>((value) =>
  isRecord(value) && typeof value.id === "string"
    ? { ok: true, value: { id: value.id } }
    : { ok: false, message: "id required" },
)

void test("generation binds selected guidance to surface creation", async () => {
  const searchOrders = action({
    name: "orders.search",
    description: "Search orders.",
    effect: "read",
    input: searchInput,
    inputJsonSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "shipped"] } },
      additionalProperties: false,
    },
    output: searchOutput,
    outputJsonSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
      additionalProperties: false,
    },
    execute: () => ({ ids: [] }),
  })
  const blocked = action({
    name: "orders.blocked",
    description: "Blocked orders action.",
    effect: "read",
    policy: "block",
    input: emptyInput,
    execute: () => ({}),
  })
  const sensitive = action({
    name: "orders.sensitive",
    description: "Sensitive orders action.",
    effect: "read",
    confidentiality: "sensitive",
    input: emptyInput,
    execute: () => ({}),
  })
  const orderChanges = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: emptyInput,
    inputJsonSchema: { type: "object", additionalProperties: false },
    event: changeEvent,
    eventJsonSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
    async *subscribe() {},
  })
  const genui = new Genui({
    actions: [searchOrders, blocked, sensitive],
    subscriptions: [orderChanges],
  })
  const ordersUi = genui.generation({
    actions: [searchOrders, blocked, sensitive],
    subscriptions: [orderChanges],
  })

  const guidance = ordersUi.guidance()

  assert.match(guidance.environment, /Generated UI: code\/0/)
  assert.match(guidance.capabilityContract, /orders\.search/)
  assert.match(guidance.capabilityContract, /OrdersSearchInput/)
  assert.match(guidance.capabilityContract, /"open" \| "shipped"/)
  assert.match(guidance.capabilityContract, /Promise<OrdersSearchOutput>/)
  assert.match(guidance.capabilityContract, /orders\.changes/)
  assert.doesNotMatch(guidance.capabilityContract, /orders\.blocked/)
  assert.doesNotMatch(guidance.capabilityContract, /orders\.sensitive/)

  const surface = await ordersUi.createSurface({
    content: "<p>Orders</p>",
    subject: "session-1",
  })

  assert.deepEqual(
    surface.grant.actions.map((descriptor) => descriptor.name),
    ["orders.search"],
  )
  assert.deepEqual(
    surface.grant.subscriptions.map((descriptor) => descriptor.name),
    ["orders.changes"],
  )
  assert.equal(surface.grant.subject, "session-1")
  assert.deepEqual(await genui.diagnostics(surface.id), {
    actions: ["orders.search", "orders.blocked", "orders.sensitive"],
    granted: ["orders.search"],
    dropped: [
      { name: "orders.blocked", reason: "blocked" },
      { name: "orders.sensitive", reason: "confidential" },
    ],
    subscriptions: ["orders.changes"],
    grantedSubscriptions: ["orders.changes"],
    droppedSubscriptions: [],
  })
})

void test("generation retains identities and reprojects current policy", async () => {
  const searchOrders = action({
    name: "orders.search",
    description: "Search orders.",
    effect: "read",
    input: emptyInput,
    execute: () => ({}),
  })
  const genui = new Genui({ actions: [searchOrders] })
  const ordersUi = genui.generation({ actions: [searchOrders] })

  assert.match(ordersUi.guidance().capabilityContract, /orders\.search/)
  Reflect.set(searchOrders, "policy", "block")

  assert.doesNotMatch(ordersUi.guidance().capabilityContract, /orders\.search/)
  const surface = await ordersUi.createSurface({ content: "<p>Orders</p>" })
  assert.deepEqual(surface.grant.actions, [])
})

void test("generation rejects duplicate and unregistered definitions", () => {
  const registered = action({
    name: "orders.search",
    description: "Search orders.",
    effect: "read",
    input: emptyInput,
    execute: () => ({}),
  })
  const unregistered = action({
    name: "orders.other",
    description: "Other orders action.",
    effect: "read",
    input: emptyInput,
    execute: () => ({}),
  })
  const genui = new Genui({ actions: [registered] })

  assert.throws(
    () => genui.generation({ actions: [registered, registered] }),
    /Duplicate generation action: orders\.search/,
  )
  assert.throws(
    () => genui.generation({ actions: [unregistered] }),
    /Generation action is not registered: orders\.other/,
  )
})
