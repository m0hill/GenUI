import assert from "node:assert/strict"
import { test } from "node:test"
import { subscriptionEventByteLimit } from "./protocol/index.js"
import {
  projectGrantedSubscriptions,
  publicSubscriptions,
  registerSubscription,
} from "./subscription-projections.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { AnySubscriptionDefinition } from "./types.js"

const objectSchema = testSchema<Readonly<Record<string, unknown>>>((value) =>
  isRecord(value) ? { ok: true, value: { ...value } } : { ok: false, message: "object required" },
)

const definition = (
  name: string,
  options: { readonly policy?: "allow" | "block"; readonly sensitive?: boolean } = {},
): AnySubscriptionDefinition<unknown> => ({
  name,
  description: `${name} events.`,
  ...(options.policy === undefined ? {} : { policy: options.policy }),
  ...(options.sensitive ? { confidentiality: "sensitive" } : {}),
  input: objectSchema,
  inputJsonSchema: { type: "object", title: `${name} input` },
  event: objectSchema,
  eventJsonSchema: { type: "object", title: `${name} event` },
  subscribe: async function* () {},
})

void test("subscription projection grants only public allowed definitions", () => {
  const allowed = definition("orders.changes")
  const blocked = definition("orders.blocked", { policy: "block" })
  const sensitive = definition("orders.sensitive", { sensitive: true })
  const byName = new Map([
    [allowed.name, registerSubscription(allowed)],
    [blocked.name, registerSubscription(blocked)],
    [sensitive.name, registerSubscription(sensitive)],
  ])

  const projection = projectGrantedSubscriptions({
    subscriptions: [allowed.name, "orders.missing", allowed.name, blocked.name, sensitive.name],
    byName,
  })

  assert.deepEqual(projection, {
    subscriptions: [
      {
        name: allowed.name,
        description: allowed.description,
        confidentiality: "normal",
        maxEventBytes: subscriptionEventByteLimit,
        inputSchema: { type: "object", title: `${allowed.name} input` },
        eventSchema: { type: "object", title: `${allowed.name} event` },
      },
    ],
    dropped: [
      { name: "orders.missing", reason: "unknown" },
      { name: allowed.name, reason: "duplicate" },
      { name: blocked.name, reason: "blocked" },
      { name: sensitive.name, reason: "confidential" },
    ],
  })
  assert.deepEqual(
    publicSubscriptions(byName.values()).map((item) => item.name),
    [allowed.name, sensitive.name],
  )
})

void test("subscription projection copies nested JSON Schemas", () => {
  const value = definition("orders.changes")
  const projected = publicSubscriptions([registerSubscription(value)])[0]
  assert.notEqual(projected, undefined)
  if (projected === undefined) return

  const inputSchema = projected.inputSchema
  const eventSchema = projected.eventSchema
  assert.notEqual(inputSchema, value.inputJsonSchema)
  assert.notEqual(eventSchema, value.eventJsonSchema)
  Reflect.set(inputSchema ?? {}, "title", "mutated")
  Reflect.set(eventSchema ?? {}, "title", "mutated")
  assert.equal(value.inputJsonSchema?.title, "orders.changes input")
  assert.equal(value.eventJsonSchema?.title, "orders.changes event")
})
