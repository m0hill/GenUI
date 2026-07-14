import assert from "node:assert/strict"
import { test } from "node:test"
import type { Action } from "../protocol/index.js"
import { codeCapabilityArtifacts, codeCapabilityContract } from "./capability-contract.js"

void test("capability contract renders supported schemas as TypeScript declarations", () => {
  const actions = [
    {
      name: "orders.get",
      description: "Get an order.",
      effect: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: ["open", "shipped"] } },
        required: ["status"],
        additionalProperties: false,
      },
    },
  ] satisfies readonly Action[]

  const contract = codeCapabilityContract(actions, [])

  assert.match(contract, /type OrdersGetInput =/)
  assert.match(contract, /id: string \/\* @minLength 1 \*\//)
  assert.match(contract, /type OrdersGetOutput =/)
  assert.match(contract, /status: "open" \| "shipped"/)
  assert.match(contract, /call\(name: "orders\.get"/)
  assert.doesNotMatch(contract, /Input JSON Schema:/)
})

void test("capability contract keeps nested constraints and annotations as comments", () => {
  const contract = codeCapabilityContract(
    [
      {
        name: "values.search",
        description: "Search values.",
        effect: "read",
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", default: "" },
            values: {
              type: "array",
              minItems: 1,
              items: { type: "integer", exclusiveMinimum: 0 },
            },
          },
          required: ["values"],
          additionalProperties: false,
        },
      },
    ],
    [],
  )

  assert.match(contract, /ReadonlyArray<number \/\* @integer; @exclusiveMinimum 0 \*\/>/)
  assert.match(contract, /query\?: string \/\* @default "" \*\//)
  assert.match(contract, /@minItems 1/)
  assert.match(contract, /additional properties are not allowed/)
})

void test("capability contract falls back to exact JSON Schema without dropping keywords", () => {
  const schema = {
    type: "object",
    properties: { value: { type: "string" } },
    allOf: [{ required: ["value"] }, { properties: { value: { minLength: 3 } } }],
  }
  const contract = codeCapabilityContract(
    [
      {
        name: "values.check",
        description: "Check a value.",
        effect: "read",
        requiresApproval: false,
        inputSchema: schema,
      },
    ],
    [],
  )

  assert.match(contract, /type ValuesCheckInput = unknown/)
  assert.match(contract, /Exact JSON Schema for ValuesCheckInput:/)
  assert.equal(contract.includes(JSON.stringify(schema)), true)
  assert.match(contract, /"allOf"/)
})

void test("capability contract disambiguates colliding generated type names", () => {
  const actions = ["orders.search", "orders_search"].map(
    (name): Action => ({
      name,
      description: `${name} action.`,
      effect: "read",
      requiresApproval: false,
      inputSchema: { type: "object", additionalProperties: false },
    }),
  )

  const contract = codeCapabilityContract(actions, [])

  assert.match(contract, /type OrdersSearchInput =/)
  assert.match(contract, /type OrdersSearch2Input =/)
})

void test("capability artifacts expose raw checker declarations from the prompt source", () => {
  const artifacts = codeCapabilityArtifacts([], [])

  assert.match(artifacts.prompt, /No actions or subscriptions are selected/)
  assert.match(artifacts.declarations, /interface GenuiActionMap \{\s*\}/)
  assert.match(artifacts.declarations, /interface GenuiSubscriptionMap \{\s*\}/)
  assert.match(artifacts.declarations, /Name extends keyof GenuiActionMap/)
  assert.doesNotMatch(artifacts.declarations, /```|Generated-interface capability contract/)
})
