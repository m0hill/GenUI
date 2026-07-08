import assert from "node:assert/strict"
import { test } from "node:test"
import { allowGenui0DataAttribute, genui0Instructions } from "./genui0.js"

const grantedCapabilities = new Set(["dice.roll"])

void test("genui/0 allows only granted capability actions with v0 object inputs", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
      grantedCapabilities,
    }),
    {
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
    },
  )

  assert.equal(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('demo.secret', {})",
      grantedCapabilities,
    }),
    undefined,
  )
  assert.equal(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value:
        "@capability('dice.roll', { sides: this['constructor']['constructor']('return 6')() })",
      grantedCapabilities,
    }),
    undefined,
  )
  assert.equal(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6 }, { target: window.location })",
      grantedCapabilities,
    }),
    undefined,
  )
})

void test("genui/0 allows simple local state expressions", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-state",
      value: "{ count: 1, label: 'Roll' }",
      grantedCapabilities,
    }),
    { name: "data-genui-state", value: "{ count: 1, label: 'Roll' }" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "$count",
      grantedCapabilities,
    }),
    { name: "data-genui-text", value: "$count" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-bind",
      value: "count",
      grantedCapabilities,
    }),
    { name: "data-genui-bind", value: "count" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-show",
      value: "$status == 'pending'",
      grantedCapabilities,
    }),
    { name: "data-genui-show", value: "$status == 'pending'" },
  )
})

void test("genui/0 rejects general JavaScript expressions", () => {
  assert.equal(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "window.location",
      grantedCapabilities,
    }),
    undefined,
  )
  assert.equal(
    allowGenui0DataAttribute({
      name: "data-genui-show",
      value: "$count > 2",
      grantedCapabilities,
    }),
    undefined,
  )
})

void test("genui/0 instructions describe dialect and capability descriptors", () => {
  const instructions = genui0Instructions([
    {
      name: "dice.roll",
      description: "Roll a die.",
      effect: "read",
      requiresApproval: false,
    },
  ])

  assert.match(instructions, /Generated UI dialect: genui\/0/)
  assert.match(instructions, /dice\.roll: Roll a die\./)
  assert.match(instructions, /target: 'resultName'/)
  assert.match(instructions, /simple v0 expressions/)
})
