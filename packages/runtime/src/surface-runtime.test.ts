import assert from "node:assert/strict"
import { test } from "node:test"
import { createSurfaceRuntime } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { AnyActionDefinition, Policy } from "./types.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "input must be an object." },
)

const actionDefinition = (name: string, policy?: Policy): AnyActionDefinition<unknown> => ({
  name,
  description: `${name} test action.`,
  effect: policy === "block" ? "dangerous" : "read",
  policy,
  input: emptyInput,
  execute: () => ({}),
})

void test("surface runtime preserves code and owns grant records and diagnostics", async () => {
  const runtime = createSurfaceRuntime({
    byName: new Map([
      ["dice.roll", actionDefinition("dice.roll")],
      ["demo.blocked", actionDefinition("demo.blocked", "block")],
    ]),
  })
  const source = {
    content: `<button>Roll</button><script type="module">genui.call("dice.roll", {})</script>`,
    actions: ["dice.roll", "missing.action", "dice.roll", "demo.blocked"],
    meta: { origin: "test" },
  }
  const surface = await runtime.surface(source)
  const record = await runtime.getRecord(surface.id)

  assert.equal(surface.content, source.content)
  assert.deepEqual(
    surface.grant.actions.map((action) => action.name),
    ["dice.roll"],
  )
  assert.deepEqual(record?.source, source)
  assert.deepEqual(record?.diagnostics, {
    actions: source.actions,
    granted: ["dice.roll"],
    dropped: [
      { name: "missing.action", reason: "unknown" },
      { name: "dice.roll", reason: "duplicate" },
      { name: "demo.blocked", reason: "blocked" },
    ],
  })
})

void test("surface runtime reprojects authority without rewriting source", async () => {
  const byName = new Map<string, AnyActionDefinition<unknown>>([
    ["dice.roll", actionDefinition("dice.roll")],
  ])
  const runtime = createSurfaceRuntime({ byName })
  const source = {
    content: `<button>Roll</button><script type="module">genui.call("dice.roll", {})</script>`,
    actions: ["dice.roll"],
  }
  const created = await runtime.surface(source)

  byName.set("dice.roll", actionDefinition("dice.roll", "block"))
  const reprojected = await runtime.reprojectSurface(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.equal(reprojected?.content, source.content)
  assert.deepEqual(reprojected?.grant.actions, [])
  assert.deepEqual(await runtime.diagnostics(created.id), {
    actions: ["dice.roll"],
    granted: [],
    dropped: [{ name: "dice.roll", reason: "blocked" }],
  })
})

void test("surface runtime accepts only the shipped dialect", async () => {
  const runtime = createSurfaceRuntime({ byName: new Map() })
  await assert.rejects(
    runtime.surface({ dialect: "code/1", content: "", actions: [] }),
    /Unsupported generated UI dialect: code\/1/,
  )
})
