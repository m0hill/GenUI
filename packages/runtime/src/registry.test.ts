import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import {
  codeDialect,
  type ActionErrorCode,
  type ActionResult,
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

const assertErrorCode = (result: ActionResult, code: ActionErrorCode): void => {
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, code)
  assert.equal(result.error.message.includes("\n"), false)
}

void test("registry projects a grant without rewriting generated code", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      action({
        name: "demo.blocked",
        description: "Blocked test capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
    ],
  })

  const content = `<button>Roll</button><script type="module">genui.call("dice.roll", { sides: 6 })</script>`
  const surface = await registry.surface({
    content,
    actions: ["dice.roll", "missing.action", "dice.roll", "demo.blocked"],
    meta: { source: "test" },
  })

  assert.equal(surface.dialect, codeDialect)
  assert.doesNotMatch(surface.id, /^surface-\d+$/)
  assert.equal(surface.grant.surfaceId, surface.id)
  assert.deepEqual(
    surface.grant.actions.map((capability) => capability.name),
    ["dice.roll"],
  )
  assert.equal(surface.content, content)
  assert.deepEqual(JSON.parse(JSON.stringify(surface)), surface)
  assert.deepEqual(await registry.diagnostics(surface.id), {
    actions: ["dice.roll", "missing.action", "dice.roll", "demo.blocked"],
    granted: ["dice.roll"],
    dropped: [
      { name: "missing.action", reason: "unknown" },
      { name: "dice.roll", reason: "duplicate" },
      { name: "demo.blocked", reason: "blocked" },
    ],
  })
})

void test("registry stores code surface content verbatim under its projected grant", async () => {
  const store = memoryStore()
  const registry = new Genui<TestCtx>({
    store,
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })
  const content = `<button onclick="run()">Roll</button><script type="module">window.run = () => genui.call("dice.roll", { sides: 6 })</script>`

  const surface = await registry.surface({
    dialect: codeDialect,
    content,
    actions: ["dice.roll"],
  })

  assert.equal(surface.dialect, codeDialect)
  assert.equal(surface.content, content)
  assert.deepEqual(
    surface.grant.actions.map((descriptor) => descriptor.name),
    ["dice.roll"],
  )
  assert.deepEqual((await registry.diagnostics(surface.id))?.dropped, [])
  assert.deepEqual((await store.get(surface.id))?.source, {
    dialect: codeDialect,
    content,
    actions: ["dice.roll"],
  })
})

void test("surface dialect type permits future dialect identifiers", () => {
  const surface: Surface = {
    id: "surface-test",
    content: "",
    grant: { surfaceId: "surface-test", actions: [] },
    dialect: "code/future",
  }

  assert.equal(surface.dialect, "code/future")
})

void test("same HTML receives different authority from different grants", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })
  const html = `<button>Roll</button><script type="module">genui.call("dice.roll", { sides: 6 })</script>`
  const armed = await registry.surface({ content: html, actions: ["dice.roll"] })
  const defanged = await registry.surface({ content: html, actions: [] })

  assert.notEqual(armed.id, defanged.id)
  assert.equal(armed.grant.surfaceId, armed.id)
  assert.equal(defanged.grant.surfaceId, defanged.id)
  assert.equal(armed.content, html)
  assert.equal(defanged.content, html)

  assert.deepEqual(
    await registry.execute(
      { surfaceId: armed.id, callId: "call-1", action: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    { ok: true, value: { total: 6 } },
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: defanged.id, callId: "call-2", action: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    "not_granted",
  )
})

void test("registry executes surfaces restored from a shared store", async () => {
  const store = memoryStore()
  const actions = [
    action({
      name: "dice.roll",
      description: "Roll a die.",
      effect: "read",
      input: rollInput,
      output: rollOutput,
      execute: (_ctx: TestCtx, input: RollInput) => ({ total: input.sides }),
    }),
  ]
  const creator = new Genui<TestCtx>({ actions, store })
  const executor = new Genui<TestCtx>({ actions, store })
  const surface = await creator.surface({
    content: `<button>Roll</button>`,
    actions: ["dice.roll"],
  })

  assert.deepEqual(
    await executor.execute(
      { surfaceId: surface.id, callId: "call-1", action: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    { ok: true, value: { total: 6 } },
  )
})

void test("registry returns a structured result when the surface store is unavailable", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
    store: {
      get: async () => {
        throw new Error("database is offline")
      },
      set: () => undefined,
      revoke: () => undefined,
      runIdempotent: async (_request, operation) => ({
        status: "result",
        result: await operation(),
      }),
    },
  })

  assert.deepEqual(
    await registry.execute(
      { surfaceId: "surface-1", callId: "call-1", action: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    {
      ok: false,
      error: {
        code: "storage_unavailable",
        message: "Surface store is unavailable.",
      },
    },
  )
})

void test("registry reprojects stored surface source under current policy", async () => {
  const store = memoryStore()
  const html = `<button>Roll</button><script type="module">genui.call("dice.roll", { sides: 6 })</script>`
  const creator = new Genui<TestCtx>({
    store: store,
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })

  const created = await creator.surface({ content: html, actions: ["dice.roll"] })
  const hardened = new Genui<TestCtx>({
    store: store,
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "dangerous",
        policy: "block",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })

  assert.deepEqual(await hardened.diagnostics(created.id), {
    actions: ["dice.roll"],
    granted: [],
    dropped: [{ name: "dice.roll", reason: "blocked" }],
  })

  const reprojected = await hardened.reproject(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.deepEqual(reprojected?.grant.actions, [])
  assert.equal(reprojected?.content, html)
})

void test("returned surface mutations cannot change registry authority", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ total: 6 }),
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Roll</button>`,
    actions: [],
  })
  const forgedDescriptor = {
    name: "dice.roll",
    description: "Forged descriptor.",
    effect: "read",
    requiresApproval: false,
  } as const

  try {
    Reflect.set(surface.grant.actions, "0", forgedDescriptor)
    Object.defineProperty(surface.grant, "capabilities", { value: [forgedDescriptor] })
  } catch {
    // Frozen public surface values are also acceptable; execution must stay denied either way.
  }

  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-1", action: "dice.roll", input: {} },
      { userId: "u1" },
    ),
    "not_granted",
  )
})

void test("descriptors expose only the public capability projection", () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      action({
        name: "demo.write",
        description: "Write data after approval.",
        effect: "write",
        policy: "ask",
        input: textInput,
        execute: (_ctx, input) => ({ accepted: input.text }),
      }),
      action({
        name: "demo.blocked",
        description: "Blocked test capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
    ],
  })

  const descriptors = registry.actions()
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.name),
    ["dice.roll", "demo.write"],
  )
  assert.deepEqual(Object.keys(descriptors[0] ?? {}).sort(), [
    "confidentiality",
    "description",
    "effect",
    "name",
    "requiresApproval",
  ])
  assert.equal(descriptors[1]?.requiresApproval, true)
  assert.match(registry.instructions(), /dice\.roll/)
  assert.doesNotMatch(registry.instructions(), /demo\.blocked/)
})

void test("action descriptors carry declared input JSON Schema", async () => {
  const inputJsonSchema = {
    type: "object",
    properties: { sides: { type: "number", minimum: 2 } },
    required: ["sides"],
    additionalProperties: false,
  } as const
  const outputJsonSchema = {
    type: "object",
    properties: { total: { type: "number" } },
    required: ["total"],
    additionalProperties: false,
  } as const
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        inputJsonSchema,
        output: rollOutput,
        outputJsonSchema,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
    ],
  })

  assert.deepEqual(registry.actions()[0]?.inputSchema, inputJsonSchema)

  const surface = await registry.surface({
    content: `<button>Roll</button>`,
    actions: ["dice.roll"],
  })
  assert.deepEqual(surface.grant.actions[0]?.inputSchema, inputJsonSchema)
})

void test("surface grants carry action intent only when defined", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ total: 6 }),
      }),
      action({
        name: "notes.create",
        description: "Create a note.",
        intent: "Create note {input.text}",
        effect: "write",
        policy: "ask",
        input: textInput,
        execute: (_ctx, input) => ({ accepted: input.text }),
      }),
    ],
  })

  const surface = await registry.surface({
    content: `<button>Roll</button><button>Create</button>`,
    actions: ["dice.roll", "notes.create"],
  })

  const roll = surface.grant.actions.find((item) => item.name === "dice.roll")
  const create = surface.grant.actions.find((item) => item.name === "notes.create")
  assert.notEqual(roll, undefined)
  assert.notEqual(create, undefined)
  if (roll === undefined || create === undefined) return

  assert.equal("intent" in roll, false)
  assert.equal(create.intent, "Create note {input.text}")
})

void test("registry executes granted capabilities and validates inputs and outputs", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (ctx, input) => ({ total: input.sides + ctx.userId.length }),
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Roll</button>`,
    actions: ["dice.roll"],
  })

  assert.deepEqual(
    await registry.execute(
      {
        surfaceId: surface.id,
        callId: "call-1",
        action: "dice.roll",
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
        action: "dice.roll",
        input: { sides: "six" },
      },
      { userId: "ab" },
    ),
    "invalid_input",
  )
})

void test("registry approval is the authoritative execution gate", async () => {
  let executed = 0
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        policy: "ask",
        input: textInput,
        execute: (_ctx, input) => {
          executed += 1
          return { accepted: input.text }
        },
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Create</button>`,
    actions: ["notes.create"],
  })
  const call = {
    surfaceId: surface.id,
    callId: "call-1",
    action: "notes.create",
    input: { text: "hi" },
  }

  assertErrorCode(await registry.execute(call, { userId: "u1" }), "approval_denied")
  assert.equal(executed, 0)

  assertErrorCode(
    await registry.execute(
      { ...call, callId: "call-2" },
      { userId: "u1" },
      { approve: () => false },
    ),
    "approval_denied",
  )
  assert.equal(executed, 0)

  assert.deepEqual(
    await registry.execute(
      { ...call, callId: "call-3" },
      { userId: "u1" },
      { approve: () => true },
    ),
    {
      ok: true,
      value: { accepted: "hi" },
    },
  )
  assert.equal(executed, 1)
})

void test("registry approval receives canonical validated input", async () => {
  const normalizedTextInput = testSchema<TextInput>((value) => {
    if (!isRecord(value) || typeof value.text !== "string") {
      return { ok: false, message: "text must be a string." }
    }
    return { ok: true, value: { text: value.text.trim() } }
  })
  let approvedInput: unknown
  let executedInput: unknown
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        policy: "ask",
        input: normalizedTextInput,
        execute: (_ctx, input) => {
          executedInput = input
          return { accepted: input.text }
        },
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Create</button>`,
    actions: ["notes.create"],
  })

  const result = await registry.execute(
    {
      surfaceId: surface.id,
      callId: "call-canonical",
      action: "notes.create",
      input: { text: "  hello  " },
    },
    { userId: "u1" },
    {
      approve: (_action, input) => {
        approvedInput = input
        return true
      },
    },
  )

  assert.deepEqual(approvedInput, { text: "hello" })
  assert.deepEqual(executedInput, { text: "hello" })
  assert.deepEqual(result, { ok: true, value: { accepted: "hello" } })
})

void test("dangerous actions require approval by default", async () => {
  let executed = false
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "system.destroy",
        description: "Destroy the test system.",
        effect: "dangerous",
        input: emptyInput,
        execute: () => {
          executed = true
          return { destroyed: true }
        },
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Destroy</button>`,
    actions: ["system.destroy"],
  })
  const descriptor = surface.grant.actions[0]
  assert.notEqual(descriptor, undefined)
  assert.equal(descriptor?.requiresApproval, true)

  const call = {
    surfaceId: surface.id,
    callId: "call-dangerous",
    action: "system.destroy",
    input: {},
  }
  assertErrorCode(await registry.execute(call, { userId: "u1" }), "approval_denied")
  assert.equal(executed, false)
  assert.deepEqual(
    await registry.execute(
      { ...call, callId: "call-dangerous-approved" },
      { userId: "u1" },
      { approve: () => true },
    ),
    {
      ok: true,
      value: { destroyed: true },
    },
  )
  assert.equal(executed, true)
})

void test("sensitive actions never enter a surface grant", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "profile.read",
        description: "Read a public profile.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ name: "Ada" }),
      }),
      action({
        name: "secrets.read",
        description: "Read a sensitive secret.",
        effect: "read",
        confidentiality: "sensitive",
        input: emptyInput,
        execute: () => ({ secret: "hidden" }),
      }),
    ],
  })
  const content = `<button>Profile</button><script type="module">genui.call("secrets.read", {})</script>`
  const surface = await registry.surface({
    content,
    actions: ["profile.read", "secrets.read"],
  })

  assert.deepEqual(
    registry.actions().map((descriptor) => [descriptor.name, descriptor.confidentiality]),
    [
      ["profile.read", "normal"],
      ["secrets.read", "sensitive"],
    ],
  )
  assert.deepEqual(
    surface.grant.actions.map((descriptor) => descriptor.name),
    ["profile.read"],
  )
  assert.match(registry.instructions(), /profile\.read/)
  assert.doesNotMatch(registry.instructions(), /secrets\.read/)
  assert.equal(surface.content, content)
  assert.deepEqual(await registry.diagnostics(surface.id), {
    actions: ["profile.read", "secrets.read"],
    granted: ["profile.read"],
    dropped: [{ name: "secrets.read", reason: "confidential" }],
  })
})

void test("registry returns every expected capability error as a value", async () => {
  const registry = new Genui<TestCtx>({
    actions: [
      action({
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        input: rollInput,
        output: rollOutput,
        execute: (_ctx, input) => ({ total: input.sides }),
      }),
      action({
        name: "demo.approve",
        description: "Approval-gated capability.",
        effect: "write",
        policy: "ask",
        input: textInput,
        execute: (_ctx, input) => ({ accepted: input.text }),
      }),
      action({
        name: "demo.blocked",
        description: "Blocked capability.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => ({}),
      }),
      action({
        name: "demo.bad_output",
        description: "Returns invalid output.",
        effect: "read",
        input: emptyInput,
        output: invalidOutput,
        execute: () => ({ total: "wrong" }),
      }),
      action({
        name: "demo.throws",
        description: "Throws during execution.",
        effect: "read",
        input: emptyInput,
        execute: () => {
          throw new Error("internal detail")
        },
      }),
      action({
        name: "demo.throw_input_schema",
        description: "Throws during input validation.",
        effect: "read",
        input: throwingSchema<Readonly<Record<string, never>>>(),
        execute: () => ({}),
      }),
      action({
        name: "demo.throw_output_schema",
        description: "Throws during output validation.",
        effect: "read",
        input: emptyInput,
        output: throwingSchema<unknown>(),
        execute: () => ({}),
      }),
    ],
  })
  const surface = await registry.surface({
    content: `<button>Roll</button>`,
    actions: [
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
      { surfaceId: "missing", callId: "call-1", action: "dice.roll", input: { sides: 6 } },
      { userId: "u1" },
    ),
    "unknown_surface",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-2", action: "demo.missing", input: {} },
      { userId: "u1" },
    ),
    "not_granted",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-3", action: "demo.blocked", input: {} },
      { userId: "u1" },
    ),
    "blocked",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-4", action: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
    ),
    "approval_denied",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-5", action: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
      { approve: () => false },
    ),
    "approval_denied",
  )
  assert.deepEqual(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-6", action: "demo.approve", input: { text: "x" } },
      { userId: "u1" },
      { approve: () => true },
    ),
    { ok: true, value: { accepted: "x" } },
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-7", action: "demo.bad_output", input: {} },
      { userId: "u1" },
    ),
    "invalid_output",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-8", action: "demo.throws", input: {} },
      { userId: "u1" },
    ),
    "execution_failed",
  )
  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-9", action: "demo.throw_input_schema", input: {} },
      { userId: "u1" },
    ),
    "invalid_input",
  )
  assertErrorCode(
    await registry.execute(
      {
        surfaceId: surface.id,
        callId: "call-10",
        action: "demo.throw_output_schema",
        input: {},
      },
      { userId: "u1" },
    ),
    "invalid_output",
  )
})

void test("registry rejects invalid and duplicate capability names at construction", () => {
  assert.throws(
    () =>
      new Genui<TestCtx>({
        actions: [
          action({
            name: "dice",
            description: "Missing namespace.",
            effect: "read",
            input: emptyInput,
            execute: () => ({}),
          }),
        ],
      }),
  )

  assert.throws(
    () =>
      new Genui<TestCtx>({
        actions: [
          action({
            name: "dice.roll",
            description: "First.",
            effect: "read",
            input: emptyInput,
            execute: () => ({}),
          }),
          action({
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
