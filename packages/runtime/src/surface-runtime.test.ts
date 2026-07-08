import assert from "node:assert/strict"
import { test } from "node:test"
import { createSurfaceRuntime } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { AnyCapabilityDefinition, Policy } from "./types.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "input must be an object." },
)

const capability = (name: string, policy?: Policy): AnyCapabilityDefinition<unknown> => ({
  name,
  description: `${name} test capability.`,
  effect: policy === "block" ? "dangerous" : "read",
  policy,
  input: emptyInput,
  execute: () => ({}),
})

void test("surface runtime owns grant projection, sanitization, records, and diagnostics", () => {
  const runtime = createSurfaceRuntime({
    byName: new Map([
      ["dice.roll", capability("dice.roll")],
      ["demo.blocked", capability("demo.blocked", "block")],
    ]),
  })

  const source = {
    html: [
      `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button>`,
      `<button data-genui-on-click="@capability('demo.blocked', {})">Blocked</button>`,
      `<script>alert(1)</script>`,
    ].join(""),
    requested: ["dice.roll", "missing.capability", "dice.roll", "demo.blocked"],
    meta: { origin: "test" },
  }
  const surface = runtime.createSurface(source)
  const record = runtime.getRecord(surface.id)

  assert.equal("source" in surface, false)
  assert.deepEqual(
    surface.grant.capabilities.map((item) => item.name),
    ["dice.roll"],
  )
  assert.match(surface.html, /dice\.roll/)
  assert.doesNotMatch(surface.html, /demo\.blocked/)
  assert.doesNotMatch(surface.html, /<script/i)
  assert.equal(record?.source.html, source.html)
  assert.deepEqual(record?.source.requested, source.requested)
  assert.deepEqual(runtime.diagnostics(surface.id), {
    requested: source.requested,
    granted: ["dice.roll"],
    dropped: [
      { name: "missing.capability", reason: "unknown" },
      { name: "dice.roll", reason: "duplicate" },
      { name: "demo.blocked", reason: "blocked" },
    ],
  })
})

void test("surface runtime reprojects from preserved source under current policy", () => {
  const byName = new Map<string, AnyCapabilityDefinition<unknown>>([
    ["dice.roll", capability("dice.roll")],
  ])
  const runtime = createSurfaceRuntime({ byName })
  const source = {
    html: `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button>`,
    requested: ["dice.roll"],
  }
  const created = runtime.createSurface(source)

  byName.set("dice.roll", capability("dice.roll", "block"))
  const reprojected = runtime.reprojectSurface(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.deepEqual(
    reprojected?.grant.capabilities.map((item) => item.name),
    [],
  )
  assert.doesNotMatch(reprojected?.html ?? "", /data-genui-on-click/)
  assert.deepEqual(runtime.getRecord(created.id)?.source, source)
  assert.deepEqual(runtime.diagnostics(created.id), {
    requested: ["dice.roll"],
    granted: [],
    dropped: [{ name: "dice.roll", reason: "blocked" }],
  })
})
