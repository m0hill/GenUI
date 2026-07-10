import assert from "node:assert/strict"
import { test } from "node:test"
import { demoActions, resetDemoOrders, watchOrderChanges, type OrderStatus } from "./actions.js"

const updateStatus = async (status: OrderStatus): Promise<void> => {
  await demoActions[2].execute({}, { id: "ord-1001", status })
}

void test("order subscription source emits a snapshot and stops on abort", async (context) => {
  resetDemoOrders()
  context.after(resetDemoOrders)
  const controller = new AbortController()
  const events = watchOrderChanges({}, { signal: controller.signal })[Symbol.asyncIterator]()

  const snapshot = await events.next()
  assert.equal(snapshot.done, false)
  assert.equal(snapshot.value?.type, "orders.snapshot")

  await updateStatus("shipped")
  const updated = await events.next()
  assert.equal(updated.done, false)
  assert.deepEqual(updated.value, {
    type: "order.updated",
    order: {
      id: "ord-1001",
      customer: "Aster Labs",
      status: "shipped",
      total: 148,
    },
    previousStatus: "processing",
  })

  const waiting = events.next()
  controller.abort()
  assert.deepEqual(await waiting, { done: true, value: undefined })
})

void test("order subscription source fails instead of growing an unbounded queue", async (context) => {
  resetDemoOrders()
  context.after(resetDemoOrders)
  const controller = new AbortController()
  const events = watchOrderChanges({}, { signal: controller.signal })[Symbol.asyncIterator]()
  await events.next()

  const statuses = [
    "pending",
    "processing",
    "shipped",
    "pending",
    "processing",
    "shipped",
    "pending",
    "processing",
    "shipped",
  ] as const
  for (const status of statuses) await updateStatus(status)

  await assert.rejects(events.next(), /source overflowed its bounded queue/)
})
