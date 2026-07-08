import assert from "node:assert/strict"
import { test } from "node:test"
import { createSurfaceRecords } from "./surface-records.js"

const descriptor = {
  name: "dice.roll",
  description: "Roll a die.",
  effect: "read",
  requiresApproval: false,
} as const

void test("surface records keep source input separate from public surface HTML", () => {
  const records = createSurfaceRecords()
  const source = {
    html: `<button data-on:click="@capability('dice.roll', {})">Roll</button><script>alert(1)</script>`,
    requested: ["dice.roll", "missing.capability"],
    meta: { origin: "test" },
  }

  const surface = records.create({
    source,
    html: `<button data-on:click="@capability('dice.roll', {})">Roll</button>`,
    capabilities: [descriptor],
  })
  const record = records.get(surface.id)

  assert.equal("source" in surface, false)
  assert.equal(surface.html.includes("<script"), false)
  assert.equal(record?.source.html, source.html)
  assert.deepEqual(record?.source.requested, source.requested)
  assert.deepEqual(record?.source.meta, source.meta)
  assert.deepEqual(record?.surface, surface)
})
