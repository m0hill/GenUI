import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemorySurfaceStore, createSurfaceRecord } from "./surface-records.js"

const descriptor = {
  name: "dice.roll",
  description: "Roll a die.",
  effect: "read",
  requiresApproval: false,
} as const

void test("surface records keep source input separate from public surface HTML", async () => {
  const store = createMemorySurfaceStore()
  const source = {
    html: `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button><script>alert(1)</script>`,
    requested: ["dice.roll", "missing.capability"],
    meta: { origin: "test" },
  }

  const record = createSurfaceRecord({
    source,
    html: `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button>`,
    capabilities: [descriptor],
  })
  await store.set(record)
  const stored = await store.get(record.surface.id)

  assert.equal("source" in record.surface, false)
  assert.equal(record.surface.html.includes("<script"), false)
  assert.equal(stored?.source.html, source.html)
  assert.deepEqual(stored?.source.requested, source.requested)
  assert.deepEqual(stored?.source.meta, source.meta)
  assert.deepEqual(stored?.surface, record.surface)
})
