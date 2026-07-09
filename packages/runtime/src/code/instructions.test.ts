import assert from "node:assert/strict"
import { test } from "node:test"
import type { Action } from "../types.js"
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
