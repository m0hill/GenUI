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

void test("surface runtime owns grant projection, sanitization, records, and diagnostics", async () => {
  const runtime = createSurfaceRuntime({
    byName: new Map([
      ["dice.roll", actionDefinition("dice.roll")],
      ["demo.blocked", actionDefinition("demo.blocked", "block")],
    ]),
  })

  const source = {
    html: [
      `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button>`,
      `<button data-genui-on-click="@capability('demo.blocked', {})">Blocked</button>`,
      `<script>alert(1)</script>`,
    ].join(""),
    actions: ["dice.roll", "missing.action", "dice.roll", "demo.blocked"],
    meta: { origin: "test" },
  }
  const surface = await runtime.surface(source)
  const record = await runtime.getRecord(surface.id)

  assert.equal("source" in surface, false)
  assert.deepEqual(
    surface.grant.actions.map((item) => item.name),
    ["dice.roll"],
  )
  assert.match(surface.html, /dice\.roll/)
  assert.doesNotMatch(surface.html, /demo\.blocked/)
  assert.doesNotMatch(surface.html, /<script/i)
  assert.equal(record?.source.html, source.html)
  assert.deepEqual(record?.source.actions, source.actions)
  assert.deepEqual(record?.source.meta, source.meta)
  const expectedDiagnostics = {
    actions: source.actions,
    granted: ["dice.roll"],
    dropped: [
      { name: "missing.action", reason: "unknown" },
      { name: "dice.roll", reason: "duplicate" },
      { name: "demo.blocked", reason: "blocked" },
    ],
    html: {
      dropped: [
        {
          node: "button",
          attribute: "data-genui-on-click",
          value: "@capability('demo.blocked', {})",
          reason: "ungranted_action",
        },
        { node: "script", reason: "forbidden_element" },
      ],
    },
  }
  assert.deepEqual(record?.diagnostics, expectedDiagnostics)
  assert.deepEqual(await runtime.diagnostics(surface.id), expectedDiagnostics)
})

void test("surface runtime reprojects from preserved source under current policy", async () => {
  const byName = new Map<string, AnyActionDefinition<unknown>>([
    ["dice.roll", actionDefinition("dice.roll")],
  ])
  const runtime = createSurfaceRuntime({ byName })
  const source = {
    html: `<button data-genui-on-click="@capability('dice.roll', {})">Roll</button>`,
    actions: ["dice.roll"],
  }
  const created = await runtime.surface(source)

  byName.set("dice.roll", actionDefinition("dice.roll", "block"))
  const reprojected = await runtime.reprojectSurface(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.deepEqual(
    reprojected?.grant.actions.map((item) => item.name),
    [],
  )
  assert.doesNotMatch(reprojected?.html ?? "", /data-genui-on-click/)
  assert.deepEqual((await runtime.getRecord(created.id))?.source, source)
  assert.deepEqual(await runtime.diagnostics(created.id), {
    actions: ["dice.roll"],
    granted: [],
    dropped: [{ name: "dice.roll", reason: "blocked" }],
    html: {
      dropped: [
        {
          node: "button",
          attribute: "data-genui-on-click",
          value: "@capability('dice.roll', {})",
          reason: "ungranted_action",
        },
      ],
    },
  })
})
