import assert from "node:assert/strict"
import { test } from "node:test"
import {
  codeDialect,
  subscriptionEventByteLimit,
  type ActionErrorCode,
  type ActionResult,
  type Surface,
} from "./protocol/index.js"
import { action, Genui, subscription } from "./registry.js"
import type { StandardSchemaV1 } from "./schema.js"
import { memoryStore } from "./surface-runtime.js"
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

void test("generation projects a grant without rewriting generated code", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const blockedDemo = action({
    name: "demo.blocked",
    description: "Blocked test capability.",
    effect: "dangerous",
    policy: "block",
    input: emptyInput,
    execute: () => ({}),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice, blockedDemo],
  })

  const content = `<button>Roll</button><script type="module">genui.call("dice.roll", { sides: 6 })</script>`
  const surface = await registry.generation({ actions: [rollDice, blockedDemo] }).createSurface({
    content,
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
    actions: ["dice.roll", "demo.blocked"],
    granted: ["dice.roll"],
    dropped: [{ name: "demo.blocked", reason: "blocked" }],
    subscriptions: [],
    grantedSubscriptions: [],
    droppedSubscriptions: [],
  })
})

void test("registry stores code surface content verbatim under its projected grant", async () => {
  const store = memoryStore()
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const registry = new Genui<TestCtx>({
    store,
    actions: [rollDice],
  })
  const content = `<button onclick="run()">Roll</button><script type="module">window.run = () => genui.call("dice.roll", { sides: 6 })</script>`

  const surface = await registry.generation({ actions: [rollDice] }).createSurface({ content })

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
    subscriptions: [],
  })
})

void test("surface dialect type permits future dialect identifiers", () => {
  const surface: Surface = {
    id: "surface-test",
    content: "",
    grant: { surfaceId: "surface-test", actions: [], subscriptions: [] },
    dialect: "code/future",
  }

  assert.equal(surface.dialect, "code/future")
})

void test("same HTML receives different authority from different grants", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice],
  })
  const html = `<button>Roll</button><script type="module">genui.call("dice.roll", { sides: 6 })</script>`
  const armed = await registry.generation({ actions: [rollDice] }).createSurface({ content: html })
  const defanged = await registry.generation({ actions: [] }).createSurface({ content: html })

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
  const surface = await creator
    .generation({ actions })
    .createSurface({ content: `<button>Roll</button>` })

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
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const creator = new Genui<TestCtx>({
    store: store,
    actions: [rollDice],
  })

  const created = await creator.generation({ actions: [rollDice] }).createSurface({ content: html })
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
    subscriptions: [],
    grantedSubscriptions: [],
    droppedSubscriptions: [],
  })

  const reprojected = await hardened.reproject(created.id)

  assert.equal(reprojected?.id, created.id)
  assert.deepEqual(reprojected?.grant.actions, [])
  assert.equal(reprojected?.content, html)
})

void test("returned surface mutations cannot change registry authority", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: emptyInput,
    execute: () => ({ total: 6 }),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice],
  })
  const surface = await registry
    .generation({ actions: [] })
    .createSurface({ content: `<button>Roll</button>` })
  const forgedDescriptor = {
    name: "dice.roll",
    description: "Forged descriptor.",
    effect: "read",
    requiresApproval: false,
  } as const

  Reflect.set(surface.grant.actions, "0", forgedDescriptor)
  Object.defineProperty(surface.grant, "capabilities", { value: [forgedDescriptor] })

  assertErrorCode(
    await registry.execute(
      { surfaceId: surface.id, callId: "call-1", action: "dice.roll", input: {} },
      { userId: "u1" },
    ),
    "not_granted",
  )
})

void test("descriptors expose only the public capability projection", () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const writeDemo = action({
    name: "demo.write",
    description: "Write data after approval.",
    effect: "write",
    policy: "ask",
    input: textInput,
    execute: (_ctx: TestCtx, input) => ({ accepted: input.text }),
  })
  const blockedDemo = action({
    name: "demo.blocked",
    description: "Blocked test capability.",
    effect: "dangerous",
    policy: "block",
    input: emptyInput,
    execute: () => ({}),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice, writeDemo, blockedDemo],
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
  const contract = registry
    .generation({ actions: [rollDice, writeDemo, blockedDemo] })
    .guidance().capabilityContract
  assert.match(contract, /dice\.roll/)
  assert.doesNotMatch(contract, /demo\.blocked/)
})

void test("action descriptors and generation guidance carry declared JSON Schemas", async () => {
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
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    inputJsonSchema,
    output: rollOutput,
    outputJsonSchema,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const registry = new Genui<TestCtx>({ actions: [rollDice] })

  assert.deepEqual(registry.actions()[0]?.inputSchema, inputJsonSchema)
  assert.deepEqual(registry.actions()[0]?.outputSchema, outputJsonSchema)
  const contract = registry.generation({ actions: [rollDice] }).guidance().capabilityContract
  assert.match(contract, /type DiceRollOutput/)
  assert.match(contract, /total: number/)

  const surface = await registry
    .generation({ actions: [rollDice] })
    .createSurface({ content: `<button>Roll</button>` })
  assert.deepEqual(surface.grant.actions[0]?.inputSchema, inputJsonSchema)
  assert.deepEqual(surface.grant.actions[0]?.outputSchema, outputJsonSchema)
})

void test("registry derives model schemas using each contract position's direction", async () => {
  const requested: string[] = []
  const actionInput = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: { sides: 6 } }),
      jsonSchema: {
        input: ({ target }: { readonly target: string }) => {
          requested.push(`action input ${target}`)
          return { type: "object", title: "derived action input" }
        },
        output: () => ({ type: "object", title: "wrong action input direction" }),
      },
    },
  }
  const actionOutput = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: { total: 6 } }),
      jsonSchema: {
        input: () => ({ type: "object", title: "wrong action output direction" }),
        output: ({ target }: { readonly target: string }) => {
          requested.push(`action output ${target}`)
          return { type: "object", title: "derived action output" }
        },
      },
    },
  }
  const subscriptionInput = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: {} }),
      jsonSchema: {
        input: ({ target }: { readonly target: string }) => {
          requested.push(`subscription input ${target}`)
          return { type: "object", title: "derived subscription input" }
        },
        output: () => ({ type: "object", title: "wrong subscription input direction" }),
      },
    },
  }
  const subscriptionEvent = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: { id: "order-1" } }),
      jsonSchema: {
        input: () => ({ type: "object", title: "wrong subscription event direction" }),
        output: ({ target }: { readonly target: string }) => {
          requested.push(`subscription event ${target}`)
          return { type: "object", title: "derived subscription event" }
        },
      },
    },
  }
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: actionInput,
    output: actionOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const changes = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: subscriptionInput,
    event: subscriptionEvent,
    subscribe: async function* () {},
  })

  const registry = new Genui({ actions: [rollDice], subscriptions: [changes] })

  assert.deepEqual(requested, [
    "action input draft-2020-12",
    "action output draft-2020-12",
    "subscription input draft-2020-12",
    "subscription event draft-2020-12",
  ])
  assert.equal(registry.actions()[0]?.inputSchema?.title, "derived action input")
  assert.equal(registry.actions()[0]?.outputSchema?.title, "derived action output")
  assert.equal(registry.subscriptions()[0]?.inputSchema?.title, "derived subscription input")
  assert.equal(registry.subscriptions()[0]?.eventSchema?.title, "derived subscription event")
})

void test("explicit model schemas take precedence without invoking derivation", () => {
  const derivationError = (): never => {
    throw new Error("explicit schemas must bypass derivation")
  }
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: {} }),
      jsonSchema: { input: derivationError, output: derivationError },
    },
  }
  const explicit = { type: "object", title: "explicit schema" } as const
  const configuredAction = action({
    name: "demo.explicit",
    description: "Use explicit schemas.",
    effect: "read",
    input: schema,
    inputJsonSchema: explicit,
    output: schema,
    outputJsonSchema: explicit,
    execute: () => ({}),
  })
  const configuredSubscription = subscription({
    name: "demo.events",
    description: "Use explicit schemas.",
    input: schema,
    inputJsonSchema: explicit,
    event: schema,
    eventJsonSchema: explicit,
    subscribe: async function* () {},
  })

  const registry = new Genui({
    actions: [configuredAction],
    subscriptions: [configuredSubscription],
  })

  assert.deepEqual(registry.actions()[0]?.inputSchema, explicit)
  assert.deepEqual(registry.actions()[0]?.outputSchema, explicit)
  assert.deepEqual(registry.subscriptions()[0]?.inputSchema, explicit)
  assert.deepEqual(registry.subscriptions()[0]?.eventSchema, explicit)
})

void test("model schema derivation failures reject Genui configuration", () => {
  const cause = new Error("schema cannot be represented")
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "genui-runtime-test",
      validate: () => ({ value: {} }),
      jsonSchema: {
        input: (): never => {
          throw cause
        },
        output: () => ({ type: "object" }),
      },
    },
  }
  const configuredAction = action({
    name: "demo.invalid_schema",
    description: "Fail schema derivation.",
    effect: "read",
    input: schema,
    execute: () => ({}),
  })

  assert.throws(
    () => new Genui({ actions: [configuredAction] }),
    (error: unknown) => {
      assert(error instanceof TypeError)
      assert.match(error.message, /action demo\.invalid_schema input JSON Schema/)
      assert.equal(error.cause, cause)
      return true
    },
  )
})

void test("registry projects separate read-only subscriptions", async () => {
  const inputJsonSchema = { type: "object", properties: { status: { type: "string" } } }
  const eventJsonSchema = { type: "object", properties: { id: { type: "string" } } }
  const changes = subscription({
    name: "orders.changes",
    description: "Receive order changes.",
    input: emptyInput,
    inputJsonSchema,
    event: emptyInput,
    eventJsonSchema,
    subscribe: async function* () {},
  })
  const blocked = subscription({
    name: "orders.blocked",
    description: "Blocked changes.",
    policy: "block",
    input: emptyInput,
    event: emptyInput,
    subscribe: async function* () {},
  })
  const registry = new Genui({ actions: [], subscriptions: [changes, blocked] })
  const surface = await registry
    .generation({ actions: [], subscriptions: [changes, blocked] })
    .createSurface({ content: "<p>Orders</p>" })

  assert.deepEqual(registry.subscriptions(), [
    {
      name: changes.name,
      description: changes.description,
      confidentiality: "normal",
      maxEventBytes: subscriptionEventByteLimit,
      inputSchema: inputJsonSchema,
      eventSchema: eventJsonSchema,
    },
  ])
  assert.deepEqual(
    surface.grant.subscriptions.map((item) => item.name),
    [changes.name],
  )
  assert.deepEqual(await registry.diagnostics(surface.id), {
    actions: [],
    granted: [],
    dropped: [],
    subscriptions: [changes.name, blocked.name],
    grantedSubscriptions: [changes.name],
    droppedSubscriptions: [{ name: blocked.name, reason: "blocked" }],
  })
})

void test("registry requires globally unique action and subscription names", () => {
  const definition = subscription({
    name: "orders.search",
    description: "Receive search changes.",
    input: emptyInput,
    event: emptyInput,
    subscribe: async function* () {},
  })
  const search = action({
    name: "orders.search",
    description: "Search orders.",
    effect: "read",
    input: emptyInput,
    execute: () => ({}),
  })
  assert.throws(
    () => new Genui({ actions: [search], subscriptions: [definition] }),
    /Duplicate authority name: orders\.search/,
  )
  assert.throws(
    () => new Genui({ actions: [], subscriptions: [definition, definition] }),
    /Duplicate authority name: orders\.search/,
  )
})

void test("surface grants carry action intent only when defined", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: emptyInput,
    execute: () => ({ total: 6 }),
  })
  const createNote = action({
    name: "notes.create",
    description: "Create a note.",
    intent: "Create note {input.text}",
    effect: "write",
    policy: "ask",
    input: textInput,
    execute: (_ctx: TestCtx, input) => ({ accepted: input.text }),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice, createNote],
  })

  const surface = await registry
    .generation({ actions: [rollDice, createNote] })
    .createSurface({ content: `<button>Roll</button><button>Create</button>` })

  const roll = surface.grant.actions.find((item) => item.name === "dice.roll")
  const create = surface.grant.actions.find((item) => item.name === "notes.create")
  assert.notEqual(roll, undefined)
  assert.notEqual(create, undefined)
  if (roll === undefined || create === undefined) return

  assert.equal("intent" in roll, false)
  assert.equal(create.intent, "Create note {input.text}")
})

void test("registry executes granted capabilities and validates inputs and outputs", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (ctx: TestCtx, input) => ({ total: input.sides + ctx.userId.length }),
  })
  const registry = new Genui<TestCtx>({
    actions: [rollDice],
  })
  const surface = await registry
    .generation({ actions: [rollDice] })
    .createSurface({ content: `<button>Roll</button>` })

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

void test("transforming actions canonicalize handler input and guest output", async () => {
  const dateInput: StandardSchemaV1<string, Date> = {
    "~standard": {
      version: 1,
      vendor: "genui-runtime-test",
      validate: (value) =>
        typeof value === "string"
          ? { value: new Date(value) }
          : { issues: [{ message: "date must be an ISO string." }] },
    },
  }
  const yearOutput: StandardSchemaV1<number, string> = {
    "~standard": {
      version: 1,
      vendor: "genui-runtime-test",
      validate: (value) =>
        typeof value === "number"
          ? { value: String(value) }
          : { issues: [{ message: "year must be a number." }] },
    },
  }
  let receivedInput: unknown
  const readYear = action({
    name: "dates.read_year",
    description: "Read the UTC year from an ISO date.",
    effect: "read",
    input: dateInput,
    output: yearOutput,
    execute: (_ctx: TestCtx, input) => {
      receivedInput = input
      return input.getUTCFullYear()
    },
  })
  const registry = new Genui<TestCtx>({ actions: [readYear] })
  const surface = await registry
    .generation({ actions: [readYear] })
    .createSurface({ content: `<button>Read year</button>` })

  const result = await registry.execute(
    {
      surfaceId: surface.id,
      callId: "call-transform",
      action: "dates.read_year",
      input: "2026-07-14T00:00:00.000Z",
    },
    { userId: "u1" },
  )

  assert(receivedInput instanceof Date)
  assert.equal(receivedInput.toISOString(), "2026-07-14T00:00:00.000Z")
  assert.deepEqual(result, { ok: true, value: "2026" })
})

void test("registry approval is the authoritative execution gate", async () => {
  let executed = 0
  const createNote = action({
    name: "notes.create",
    description: "Create a note.",
    effect: "write",
    policy: "ask",
    input: textInput,
    execute: (_ctx: TestCtx, input) => {
      executed += 1
      return { accepted: input.text }
    },
  })
  const registry = new Genui<TestCtx>({
    actions: [createNote],
  })
  const surface = await registry
    .generation({ actions: [createNote] })
    .createSurface({ content: `<button>Create</button>` })
  const call = {
    surfaceId: surface.id,
    callId: "call-1",
    action: "notes.create",
    input: { text: "hi" },
  }

  assertErrorCode(await registry.execute(call, { userId: "u1" }), "approval_required")
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
  const createNote = action({
    name: "notes.create",
    description: "Create a note.",
    effect: "write",
    policy: "ask",
    input: normalizedTextInput,
    execute: (_ctx: TestCtx, input) => {
      executedInput = input
      return { accepted: input.text }
    },
  })
  const registry = new Genui<TestCtx>({
    actions: [createNote],
  })
  const surface = await registry
    .generation({ actions: [createNote] })
    .createSurface({ content: `<button>Create</button>` })

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
  const destroySystem = action({
    name: "system.destroy",
    description: "Destroy the test system.",
    effect: "dangerous",
    input: emptyInput,
    execute: () => {
      executed = true
      return { destroyed: true }
    },
  })
  const registry = new Genui<TestCtx>({
    actions: [destroySystem],
  })
  const surface = await registry
    .generation({ actions: [destroySystem] })
    .createSurface({ content: `<button>Destroy</button>` })
  const descriptor = surface.grant.actions[0]
  assert.notEqual(descriptor, undefined)
  assert.equal(descriptor?.requiresApproval, true)

  const call = {
    surfaceId: surface.id,
    callId: "call-dangerous",
    action: "system.destroy",
    input: {},
  }
  assertErrorCode(await registry.execute(call, { userId: "u1" }), "approval_required")
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
  const readProfile = action({
    name: "profile.read",
    description: "Read a public profile.",
    effect: "read",
    input: emptyInput,
    execute: () => ({ name: "Ada" }),
  })
  const readSecrets = action({
    name: "secrets.read",
    description: "Read a sensitive secret.",
    effect: "read",
    confidentiality: "sensitive",
    input: emptyInput,
    execute: () => ({ secret: "hidden" }),
  })
  const registry = new Genui<TestCtx>({
    actions: [readProfile, readSecrets],
  })
  const content = `<button>Profile</button><script type="module">genui.call("secrets.read", {})</script>`
  const generation = registry.generation({ actions: [readProfile, readSecrets] })
  const surface = await generation.createSurface({ content })

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
  assert.match(generation.guidance().capabilityContract, /profile\.read/)
  assert.doesNotMatch(generation.guidance().capabilityContract, /secrets\.read/)
  assert.equal(surface.content, content)
  assert.deepEqual(await registry.diagnostics(surface.id), {
    actions: ["profile.read", "secrets.read"],
    granted: ["profile.read"],
    dropped: [{ name: "secrets.read", reason: "confidential" }],
    subscriptions: [],
    grantedSubscriptions: [],
    droppedSubscriptions: [],
  })
})

void test("registry returns every expected capability error as a value", async () => {
  const rollDice = action({
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    input: rollInput,
    output: rollOutput,
    execute: (_ctx: TestCtx, input) => ({ total: input.sides }),
  })
  const approveDemo = action({
    name: "demo.approve",
    description: "Approval-gated capability.",
    effect: "write",
    policy: "ask",
    input: textInput,
    execute: (_ctx: TestCtx, input) => ({ accepted: input.text }),
  })
  const blockedDemo = action({
    name: "demo.blocked",
    description: "Blocked capability.",
    effect: "dangerous",
    policy: "block",
    input: emptyInput,
    execute: () => ({}),
  })
  const badOutput = action({
    name: "demo.bad_output",
    description: "Returns invalid output.",
    effect: "read",
    input: emptyInput,
    output: invalidOutput,
    execute: () => ({ total: "wrong" }),
  })
  const throwDuringExecution = action({
    name: "demo.throws",
    description: "Throws during execution.",
    effect: "read",
    input: emptyInput,
    execute: () => {
      throw new Error("internal detail")
    },
  })
  const throwDuringInputValidation = action({
    name: "demo.throw_input_schema",
    description: "Throws during input validation.",
    effect: "read",
    input: throwingSchema<Readonly<Record<string, never>>>(),
    execute: () => ({}),
  })
  const throwDuringOutputValidation = action({
    name: "demo.throw_output_schema",
    description: "Throws during output validation.",
    effect: "read",
    input: emptyInput,
    output: throwingSchema<unknown>(),
    execute: () => ({}),
  })
  const registry = new Genui<TestCtx>({
    actions: [
      rollDice,
      approveDemo,
      blockedDemo,
      badOutput,
      throwDuringExecution,
      throwDuringInputValidation,
      throwDuringOutputValidation,
    ],
  })
  const surface = await registry
    .generation({
      actions: [
        rollDice,
        approveDemo,
        blockedDemo,
        badOutput,
        throwDuringExecution,
        throwDuringInputValidation,
        throwDuringOutputValidation,
      ],
    })
    .createSurface({ content: `<button>Roll</button>` })

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
    "approval_required",
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

  const missingOutputValidator = {
    name: "dice.describe",
    description: "Describe a die roll.",
    effect: "read",
    input: emptyInput,
    outputJsonSchema: { type: "object" },
    execute: () => ({}),
  }
  assert.throws(
    () =>
      new Genui<TestCtx>({
        // Runtime validation protects JavaScript and untyped callers as well as TypeScript callers.
        actions: [missingOutputValidator as never],
      }),
    /output JSON Schema requires output validation: dice\.describe/,
  )
})
