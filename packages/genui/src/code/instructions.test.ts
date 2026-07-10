import assert from "node:assert/strict"
import { test } from "node:test"
import { mcpUiStyleVariableKeys } from "../host-context.js"
import type { Action } from "../protocol/index.js"
import { codeInstructions } from "./instructions.js"

void test("code instructions include every granted action name and input schema", () => {
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
})

void test("code instructions teach portable host styling", () => {
  const instructions = codeInstructions([])

  assert.match(instructions, /## Host styling/)
  assert.match(instructions, /var\(--color-background-primary, [^)]+\)/)
  assert.match(instructions, /light-dark\(/)
  assert.match(instructions, /system-ui/)
  assert.match(instructions, /--border-radius-sm/)
  assert.doesNotMatch(instructions, /--border-radius-small/)
})

void test("code instructions list every standardized host style variable", () => {
  const instructions = codeInstructions([])

  for (const key of mcpUiStyleVariableKeys) {
    assert.equal(instructions.includes(`\`${key}\``), true, `missing ${key}`)
  }
})
