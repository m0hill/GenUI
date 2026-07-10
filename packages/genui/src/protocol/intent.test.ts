import assert from "node:assert/strict"
import { test } from "node:test"
import { renderActionIntent } from "./index.js"

void test("renderActionIntent substitutes primitive values", () => {
  assert.equal(
    renderActionIntent("Refund order {input.id}", { id: "order-1" }),
    "Refund order order-1",
  )
  assert.equal(renderActionIntent("Roll d{input.sides}", { sides: 6 }), "Roll d6")
  assert.equal(renderActionIntent("Enabled: {input.enabled}", { enabled: true }), "Enabled: true")
})

void test("renderActionIntent resolves nested input paths", () => {
  assert.equal(
    renderActionIntent("Refund order {input.order.id}", { order: { id: "order-1" } }),
    "Refund order order-1",
  )
})

void test("renderActionIntent renders missing paths as question marks", () => {
  assert.equal(renderActionIntent("Refund order {input.order.id}", { order: {} }), "Refund order ?")
})

void test("renderActionIntent renders non-primitive values as question marks", () => {
  assert.equal(
    renderActionIntent("Use filters {input.filters}", { filters: { status: "open" } }),
    "Use filters ?",
  )
})

void test("renderActionIntent leaves templates with no placeholders unchanged", () => {
  assert.equal(renderActionIntent("Create note", { text: "hello" }), "Create note")
})

void test("renderActionIntent renders multiple placeholders", () => {
  assert.equal(
    renderActionIntent("Move {input.count} items to {input.target}", {
      count: 3,
      target: "archive",
    }),
    "Move 3 items to archive",
  )
})
