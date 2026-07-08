import assert from "node:assert/strict"
import { test } from "node:test"
import { createRegistry, defineCapability } from "./registry.js"
import {
  genuiDialect,
  type CapabilityErrorCode,
  type CapabilityResult,
  type StandardSchemaV1,
  type Surface,
} from "./types.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

interface TestCtx {
  readonly userId: string
}

interface RollInput {
  readonly sides: number
}

interface RollOutput {
  readonly total: number
}

interface TextInput {
  readonly text: string
}

const rollInput = testSchema<RollInput>((value) => {
  if (!isRecord(value) || typeof value.sides !== "number") {
    return { ok: false, message: "sides must be a number." }
  }
  return { ok: true, value: { sides: value.sides } }
})

const rollOutput = testSchema<RollOutput>((value) => {
  if (!isRecord(value) || typeof value.total !== "number") {
    return { ok: false, message: "total must be a number." }
  }
  return { ok: true, value: { total: value.total } }
})

const textInput = testSchema<TextInput>((value) => {
  if (!isRecord(value) || typeof value.text !== "string" || value.text.length === 0) {
    return { ok: false, message: "text must be a non-empty string." }
  }
  return { ok: true, value: { text: value.text } }
})

const invalidOutput = testSchema<unknown>(() => ({
  ok: false,
  message: "output is invalid for this test.",
}))

const throwingSchema = <Value>(): StandardSchemaV1<unknown, Value> => ({
  "~standard": {
    version: 1,
    vendor: "genui-runtime-test",
    validate(): never {
      throw new Error("schema exploded")
    },
  },
})

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "input must be an object." },
)

const assertErrorCode = (result: CapabilityResult, code: CapabilityErrorCode): void => {
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, code)
  assert.equal(result.error.message.includes("\n"), false)
}

void test("registry projects a grant and sanitizes HTML under that grant", () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      defineCapability({
        name: "demo.blocked",
        description: "Blocked test capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
    ],
  })

  const surface = registry.createSurface({
    html: [
      `<button data-on:click="@capability('dice.roll', { sides: 6 })">Roll</button>`,
      `<button data-on:click="@capability('demo.blocked', {})">Blocked</button>`,
      `<script>alert(1)</script>`,
    ].join(""),
    requested: ["dice.roll", "missing.capability", "dice.roll", "demo.blocked"],
    meta: { source: "test" },
  })

  assert.equal(surface.dialect, genuiDialect)
  assert.doesNotMatch(surface.id, /^surface-\d+$/)
  assert.equal(surface.grant.surfaceId, surface.id)
  assert.deepEqual(
    surface.grant.capabilities.map((capability) => capability.name),
    ["dice.roll"],
  )
  assert.match(surface.html, /data-on:click="@capability\('dice\.roll'/)
  assert.doesNotMatch(surface.html, /demo\.blocked/)
  assert.doesNotMatch(surface.html, /<script/i)
  assert.deepEqual(JSON.parse(JSON.stringify(surface)), surface)
})

void test("surface dialect type permits future dialect identifiers", () => {
  const surface: Surface = {
    id: "surface-test",
    html: "",
    grant: { surfaceId: "surface-test", capabilities: [] },
    dialect: "genui/future",
  }

  assert.equal(surface.dialect, "genui/future")
})

void test("same HTML receives different authority from different grants", async () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })
  const html = `<button data-on:click="@capability('dice.roll', { sides: 6 })">Roll</button>`
  const armed = registry.createSurface({ html, requested: ["dice.roll"] })
  const defanged = registry.createSurface({ html, requested: [] })

  assert.notEqual(armed.id, defanged.id)
  assert.equal(armed.grant.surfaceId, armed.id)
  assert.equal(defanged.grant.surfaceId, defanged.id)
  assert.match(armed.html, /data-on:click/)
  assert.doesNotMatch(defanged.html, /data-on:click/)

  assert.deepEqual(
    await registry.execute(
      { surfaceId: armed.id, callId: "call-1", capability: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    { ok: true, value: { total: 6 } },
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: defanged.id, callId: "call-2", capability: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    "not_granted",
  )
})

void test("returned surface mutations cannot change registry authority", async () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ total: 6 }),
      }),
    ],
  })
  const surface = registry.createSurface({
    html: `<button data-on:click="@capability('dice.roll', {})">Roll</button>`,
    requested: [],
  })
  const forgedDescriptor = {
    name: "dice.roll",
    description: "Forged descriptor.",
    effect: "read",
    requiresApproval: false,
  } as const

  try {
    Reflect.set(surface.grant.capabilities, "0", forgedDescriptor)
    Object.defineProperty(surface.grant, "capabilities", { value: [forgedDescriptor] })
  } catch {
    // Frozen public surface values are also acceptable; execution must stay denied either way.
  }

  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-1", capability: "dice.roll", input: {} },
      { userId: "u1" },
    ),
    "not_granted",
  )
})

void test("descriptors expose only the public capability projection", () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      defineCapability({
        name: "demo.write",
        description: "Write data after approval.",
        effect: "write",
        policy: "require_approval",
        input: textInput,
        execute: (_ctx, input) => ({ accepted: input.text }),
      }),
      defineCapability({
        name: "demo.blocked",
        description: "Blocked test capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
    ],
  })

  const descriptors = registry.descriptors()
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.name),
    ["dice.roll", "demo.write"],
  )
  assert.deepEqual(Object.keys(descriptors[0] ?? {}).sort(), [
    "description",
    "effect",
    "name",
    "requiresApproval",
  ])
  assert.equal(descriptors[1]?.requiresApproval, true)
  assert.match(registry.instructions(), /Generated UI dialect: genui\/0/)
  assert.match(registry.instructions(), /dice\.roll/)
  assert.doesNotMatch(registry.instructions(), /demo\.blocked/)
})

void test("registry executes granted capabilities and validates inputs and outputs", async () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (ctx, input) => ({ total: input.sides + ctx.userId.length }),
      }),
    ],
  })
  const surface = registry.createSurface({
    html: `<button data-on:click="@capability('dice.roll', { sides: 6 })">Roll</button>`,
    requested: ["dice.roll"],
  })

  assert.deepEqual(
    await registry.execute(
      {
        surfaceId: surface.id,
        callId: "call-1",
        capability: "dice.roll",
        input: { sides: 6 },
      },
      { userId: "ab" },
    ),
    { ok: true, value: { total: 8 } },
  )

  assertErrorCode(
    await registry.execute(
      {
        surfaceId: surface.id,
        callId: "call-2",
        capability: "dice.roll",
        input: { sides: "six" },
      },
      { userId: "ab" },
    ),
    "invalid_input",
  )
})

void test("registry returns every expected capability error as a value", async () => {
  const registry = createRegistry<TestCtx>({
    capabilities: [
      defineCapability({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      defineCapability({
        name: "demo.approve",
        description: "Approval-gated capability.",
        effect: "write",
        policy: "require_approval",
        input: textInput,
        execute: (_ctx, input) => ({ accepted: input.text }),
      }),
      defineCapability({
        name: "demo.blocked",
        description: "Blocked capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
      defineCapability({
        name: "demo.bad_output",
        description: "Returns invalid output.",
        effect: "read",
        input: emptyInput,
        output: invalidOutput,
        execute: () => ({ total: "wrong" }),
      }),
      defineCapability({
        name: "demo.throws",
        description: "Throws during execution.",
        effect: "read",
        input: emptyInput,
        execute: () => {
          throw new Error("internal detail")
        },
      }),
      defineCapability({
        name: "demo.throw_input_schema",
        description: "Throws during input validation.",
        effect: "read",
        input: throwingSchema<Readonly<Record<string, never>>>(),
        execute: () => ({}),
      }),
      defineCapability({
        name: "demo.throw_output_schema",
        description: "Throws during output validation.",
        effect: "read",
        input: emptyInput,
        output: throwingSchema<unknown>(),
        execute: () => ({}),
      }),
    ],
  })
  const surface = registry.createSurface({
    html: `<button data-on:click="@capability('dice.roll', { sides: 6 })">Roll</button>`,
    requested: [
      "dice.roll",
      "demo.approve",
      "demo.bad_output",
      "demo.throws",
      "demo.throw_input_schema",
      "demo.throw_output_schema",
    ],
  })

  assertErrorCode(
    await registry.execute(
      { surfaceId: "missing", callId: "call-1", capability: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    "unknown_surface",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-2", capability: "demo.missing", input: {} },
      { userId: "u1" },
    ),
    "not_granted",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-3", capability: "demo.blocked", input: {} },
      { userId: "u1" },
    ),
    "blocked",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-4", capability: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
    ),
    "approval_denied",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-5", capability: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
      { approve: () => false },
    ),
    "approval_denied",
  )
  assert.deepEqual(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-6", capability: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
      { approve: () => true },
    ),
    { ok: true, value: { accepted: "x" } },
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-7", capability: "demo.bad_output", input: {} },
      { userId: "u1" },
    ),
    "invalid_output",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-8", capability: "demo.throws", input: {} },
      { userId: "u1" },
    ),
    "execution_failed",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-9", capability: "demo.throw_input_schema", input: {} },
      { userId: "u1" },
    ),
    "invalid_input",
  )
  assertErrorCode(
    await registry.execute(
      {
        surfaceId: surface.id,
        callId: "call-10",
        capability: "demo.throw_output_schema",
        input: {},
      },
      { userId: "u1" },
    ),
    "invalid_output",
  )
})

void test("registry rejects invalid and duplicate capability names at construction", () => {
  assert.throws(() =>
    createRegistry<TestCtx>({
      capabilities: [
        defineCapability({
          name: "dice",
          description: "Missing namespace.",
          effect: "read",
          input: emptyInput,
          execute: () => ({}),
        }),
      ],
    }),
  )

  assert.throws(() =>
    createRegistry<TestCtx>({
      capabilities: [
        defineCapability({
          name: "dice.roll",
          description: "First.",
          effect: "read",
          input: emptyInput,
          execute: () => ({}),
        }),
        defineCapability({
          name: "dice.roll",
          description: "Second.",
          effect: "read",
          input: emptyInput,
          execute: () => ({}),
        }),
      ],
    }),
  )
})
