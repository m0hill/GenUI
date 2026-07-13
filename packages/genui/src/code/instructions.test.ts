import assert from "node:assert/strict"
import { test } from "node:test"
import { mcpUiStyleVariableKeys } from "../host-context.js"
import { subscriptionEventByteLimit } from "../protocol/index.js"
import type { Action, Subscription } from "../protocol/index.js"
import { codeInstructions } from "./instructions.js"

void test("code instructions include every granted action name and declared schema", () => {
  const actions = [
    {
      name: "orders.search",
      description: "Search orders.",
      effect: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { status: { enum: ["open", "shipped"] } },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    {
      name: "orders.update_status",
      description: "Update an order status.",
      effect: "write",
      requiresApproval: true,
      intent: "Set {input.id} to {input.status}",
      inputSchema: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  ] satisfies readonly Action[]

  const instructions = codeInstructions(actions)

  for (const action of actions) {
    assert.equal(instructions.includes(action.name), true)
    assert.equal(instructions.includes(JSON.stringify(action.inputSchema, null, 2)), true)
  }
  assert.equal(instructions.includes(JSON.stringify(actions[0]?.outputSchema, null, 2)), true)
  assert.match(instructions, /Output JSON Schema:/)
})

void test("code instructions include granted subscription input and event schemas", () => {
  const subscriptions = [
    {
      name: "orders.changes",
      description: "Receive matching order changes.",
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
      inputSchema: {
        type: "object",
        properties: { status: { enum: ["processing", "shipped"] } },
        additionalProperties: false,
      },
      eventSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  ] satisfies readonly Subscription[]

  const instructions = codeInstructions([], subscriptions)

  assert.match(instructions, /## Granted subscriptions/)
  assert.match(instructions, /orders\.changes/)
  assert.equal(instructions.includes(JSON.stringify(subscriptions[0]?.inputSchema, null, 2)), true)
  assert.equal(instructions.includes(JSON.stringify(subscriptions[0]?.eventSchema, null, 2)), true)
  assert.match(instructions, /Maximum event size: 65536 bytes/)
})

void test("code instructions teach the read-only subscription guest contract", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /## Subscriptions/)
  assert.match(instructions, /genui\.subscriptions/)
  assert.match(instructions, /genui\.subscribe\(/)
  assert.match(instructions, /read-only authority, not host capabilities/)
  assert.match(instructions, /Events arrive in order/)
  assert.match(instructions, /handler's returned Promise/)
  assert.match(instructions, /done` Promise always\s+resolves/)
  assert.match(instructions, /unsubscribe\(\)/)
  assert.match(instructions, /no automatic reconnect or replay/)
  assert.match(instructions, /EventSource/)
})

void test("code instructions teach portable host styling", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /## Host styling/)
  assert.match(instructions, /Use a standardized token for\s+every visual property it covers/)
  assert.match(instructions, /Do not hardcode those values directly/)
  assert.match(instructions, /layout geometry, spacing, and behavior/)
  assert.match(instructions, /var\(--color-background-primary, [^)]+\)/)
  assert.match(instructions, /light-dark\(/)
  assert.match(instructions, /system-ui/)
  assert.match(instructions, /--border-radius-sm/)
  assert.doesNotMatch(instructions, /--border-radius-small/)
})

void test("code instructions teach optional host capabilities", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /## Host capabilities/)
  assert.match(instructions, /genui\.capabilities/)
  assert.match(instructions, /genui\.sendMessage\(/)
  assert.match(instructions, /genui\.openLink\(/)
  assert.match(instructions, /genui\.updateModelContext\(/)
  assert.match(instructions, /absolute HTTPS URLs/)
  assert.match(instructions, /may trigger a model follow-up/)
  assert.match(instructions, /without triggering an immediate follow-up/)
  assert.match(instructions, /may be denied/)
})

void test("code instructions teach graceful teardown", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /genui\.teardown\(/)
  assert.match(instructions, /cleanup handler/)
  assert.match(instructions, /deadline/)
})

void test("code instructions teach portable host context", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /genui\.hostContext/)
  assert.match(instructions, /genui\.onHostContextChange\(/)
  assert.match(instructions, /Intl\.DateTimeFormat\(locale, \{ timeZone \}\)/)
  assert.match(instructions, /containerDimensions/)
  assert.match(instructions, /platform/)
  assert.match(instructions, /user-agent sniffing/)
  assert.match(instructions, /responsive CSS/)
  assert.match(instructions, /fixed host-owned dimensions/)
  assert.match(instructions, /merged `genui\.hostContext`/)
})

void test("code instructions list every standardized host style variable", () => {
  const instructions = codeInstructions([])

  for (const key of mcpUiStyleVariableKeys) {
    assert.equal(instructions.includes(`\`${key}\``), true, `missing ${key}`)
  }
})
