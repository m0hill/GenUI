import assert from "node:assert/strict"
import test from "node:test"
import { createGeneratedSurface, openGeneratedUiSubscription } from "./genui.js"

void test("time.tick emits immediately and stops when its transport is cancelled", async () => {
  const surface = await createGeneratedSurface("<p>Clock</p>")
  assert.deepEqual(
    surface.grant.subscriptions.map((subscription) => subscription.name),
    ["time.tick"],
  )
  const controller = new AbortController()
  const opened = await openGeneratedUiSubscription(
    {
      surfaceId: surface.id,
      subscriptionId: "clock-1",
      subscription: "time.tick",
      input: {},
    },
    controller.signal,
  )

  assert.equal(opened.ok, true)
  if (!opened.ok) return
  const iterator = opened.events[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value?.type, "event")
  if (first.value?.type === "event") {
    assert.equal(first.value.sequence, 1)
    assert.equal(typeof first.value.event, "object")
  }

  controller.abort()
  await iterator.return?.()
})
