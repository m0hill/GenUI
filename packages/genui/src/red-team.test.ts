import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "Expected an object." },
)

void test("red team: subject mismatch is denied before validation or execution", async () => {
  const store = memoryStore()
  let validations = 0
  let executions = 0
  const runtime = new Genui({
    store,
    actions: [
      action({
        name: "profile.read",
        description: "Read the current profile.",
        effect: "read",
        input: testSchema<Readonly<Record<string, never>>>((value) => {
          validations += 1
          return isRecord(value)
            ? { ok: true, value: {} }
            : { ok: false, message: "Expected an object." }
        }),
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Read profile</button>",
    actions: ["profile.read"],
    subject: "session-1",
  })

  const denied = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-wrong-subject",
      action: "profile.read",
      input: {},
    },
    {},
    { subject: "session-2" },
  )

  assert.equal(denied.ok ? undefined : denied.error.code, "not_granted")
  assert.equal(validations, 0)
  assert.equal(executions, 0)

  const missing = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-missing-subject",
      action: "profile.read",
      input: {},
    },
    {},
  )
  assert.equal(missing.ok ? undefined : missing.error.code, "not_granted")
  assert.equal(validations, 0)
  assert.equal(executions, 0)
  assert.equal(surface.grant.subject, "session-1")
  assert.equal((await store.get(surface.id))?.subject, "session-1")
  assert.equal((await store.get(surface.id))?.source.subject, "session-1")

  const allowed = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-right-subject",
      action: "profile.read",
      input: {},
    },
    {},
    { subject: "session-1" },
  )
  assert.deepEqual(allowed, { ok: true, value: { execution: 1 } })
  assert.equal(validations, 1)
  assert.equal(executions, 1)
})

void test("red team: current block policy overrides an older surface grant", async () => {
  const store = memoryStore()
  const grantedRuntime = new Genui({
    store,
    actions: [
      action({
        name: "system.reset",
        description: "Reset the system.",
        effect: "dangerous",
        policy: "allow",
        input: emptyInput,
        execute: () => ({ reset: true }),
      }),
    ],
  })
  const surface = await grantedRuntime.surface({
    content: "<button>Reset</button>",
    actions: ["system.reset"],
  })
  let executed = false
  const blockedRuntime = new Genui({
    store,
    actions: [
      action({
        name: "system.reset",
        description: "Reset the system.",
        effect: "dangerous",
        policy: "block",
        input: emptyInput,
        execute: () => {
          executed = true
          return { reset: true }
        },
      }),
    ],
  })

  const result = await blockedRuntime.execute(
    { surfaceId: surface.id, callId: "call-1", action: "system.reset", input: {} },
    {},
  )

  assert.deepEqual(result, {
    ok: false,
    error: { code: "blocked", message: "Action is blocked." },
  })
  assert.equal(executed, false)
})

void test("red team: invalid input never asks approval or executes", async () => {
  let validated = 0
  let approvals = 0
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        input: testSchema<Readonly<{ text: string }>>(() => {
          validated += 1
          return { ok: false, message: "Expected note text." }
        }),
        execute: () => {
          executions += 1
          return { created: true }
        },
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Create</button>",
    actions: ["notes.create"],
  })

  const result = await runtime.execute(
    { surfaceId: surface.id, callId: "call-1", action: "notes.create", input: {} },
    {},
    {
      approve: () => {
        approvals += 1
        return true
      },
    },
  )

  assert.equal(result.ok ? undefined : result.error.code, "invalid_input")
  assert.equal(validated, 1)
  assert.equal(approvals, 0)
  assert.equal(executions, 0)
})

void test("red team: approval denial returns approval_denied without execution", async () => {
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        input: emptyInput,
        execute: () => {
          executions += 1
          return { created: true }
        },
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Create</button>",
    actions: ["notes.create"],
  })

  const result = await runtime.execute(
    { surfaceId: surface.id, callId: "call-1", action: "notes.create", input: {} },
    {},
    { approve: () => false },
  )

  assert.equal(result.ok ? undefined : result.error.code, "approval_denied")
  assert.equal(executions, 0)
})

void test("red team: a surface cannot exceed eight in-flight calls", async () => {
  let executions = 0
  let release: (() => void) | undefined
  let markEightStarted: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const eightStarted = new Promise<void>((resolve) => {
    markEightStarted = resolve
  })
  const runtime = new Genui({
    actions: [
      action({
        name: "reports.read",
        description: "Read a report.",
        effect: "read",
        input: emptyInput,
        execute: async () => {
          executions += 1
          if (executions === 8) markEightStarted?.()
          if (executions <= 8) await gate
          return { ready: true }
        },
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Read</button>",
    actions: ["reports.read"],
  })
  const calls = Array.from({ length: 9 }, (_, index) =>
    runtime.execute(
      {
        surfaceId: surface.id,
        callId: `call-${index + 1}`,
        action: "reports.read",
        input: {},
      },
      {},
    ),
  )

  await eightStarted
  assert.equal(executions, 8)

  release?.()
  const completed = await Promise.all(calls)
  assert.equal(completed.filter((result) => result.ok).length, 8)
  assert.deepEqual(
    completed.flatMap((result) => (result.ok ? [] : [result.error.code])),
    ["rate_limited"],
  )
})

void test("red team: inputs over 64 KiB are rejected before validation", async () => {
  let validations = 0
  let approvals = 0
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        input: testSchema<Readonly<{ text: string }>>((value) => {
          validations += 1
          return isRecord(value) && typeof value.text === "string"
            ? { ok: true, value: { text: value.text } }
            : { ok: false, message: "Expected note text." }
        }),
        execute: () => {
          executions += 1
          return { created: true }
        },
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Create</button>",
    actions: ["notes.create"],
  })

  const result = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-large",
      action: "notes.create",
      input: { text: "x".repeat(64 * 1_024) },
    },
    {},
    {
      approve: () => {
        approvals += 1
        return true
      },
    },
  )

  assert.equal(result.ok ? undefined : result.error.code, "invalid_input")
  assert.equal(validations, 0)
  assert.equal(approvals, 0)
  assert.equal(executions, 0)
})
