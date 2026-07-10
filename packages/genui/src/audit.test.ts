import assert from "node:assert/strict"
import { test } from "node:test"
import { action, type CallAuditEntry, type CallErrorEvent, Genui } from "./registry.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "Expected an object." },
)

void test("audit records a successful call after execution", async () => {
  const entries: CallAuditEntry[] = []
  let executed = false
  const runtime = new Genui({
    onCall: (entry) => {
      assert.equal(executed, true)
      entries.push(entry)
    },
    actions: [
      action({
        name: "profile.read",
        description: "Read a profile.",
        effect: "read",
        input: emptyInput,
        execute: () => {
          executed = true
          return { name: "Ada" }
        },
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "",
    actions: ["profile.read"],
    subject: "session-1",
  })

  const result = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-1",
      action: "profile.read",
      input: {},
    },
    {},
    { subject: "session-1" },
  )

  assert.deepEqual(result, { ok: true, value: { name: "Ada" } })
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], {
    surfaceId: surface.id,
    callId: "call-1",
    subject: "session-1",
    action: "profile.read",
    effect: "read",
    outcome: "ok",
    at: entries[0]?.at,
  })
  assert.equal(Number.isFinite(entries[0]?.at), true)
})

void test("audit records denied and invalid call outcomes", async () => {
  const entries: CallAuditEntry[] = []
  let executions = 0
  const runtime = new Genui({
    onCall: (entry) => {
      entries.push(entry)
    },
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        input: emptyInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["notes.create"] })

  const denied = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-denied",
      action: "notes.create",
      input: {},
    },
    {},
    { approve: () => false },
  )
  const invalid = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-invalid",
      action: "notes.create",
      input: null,
    },
    {},
  )

  assert.equal(denied.ok ? undefined : denied.error.code, "approval_denied")
  assert.equal(invalid.ok ? undefined : invalid.error.code, "invalid_input")
  assert.deepEqual(
    entries.map((entry) => ({
      callId: entry.callId,
      effect: entry.effect,
      outcome: entry.outcome,
    })),
    [
      { callId: "call-denied", effect: "write", outcome: "approval_denied" },
      { callId: "call-invalid", effect: "write", outcome: "invalid_input" },
    ],
  )
  assert.equal(executions, 0)
})

void test("a throwing audit hook cannot change the action result", async () => {
  const errors: CallErrorEvent[] = []
  let executions = 0
  const runtime = new Genui({
    onError: (event) => {
      errors.push(event)
    },
    onCall: () => {
      throw new Error("Audit backend failed")
    },
    actions: [
      action({
        name: "profile.read",
        description: "Read a profile.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["profile.read"] })

  const result = await runtime.execute(
    { surfaceId: surface.id, callId: "call-1", action: "profile.read", input: {} },
    {},
  )

  assert.deepEqual(result, { ok: true, value: { execution: 1 } })
  assert.equal(executions, 1)
  assert.equal(errors[0]?.phase, "audit")
  assert.match(String(errors[0]?.cause), /Audit backend failed/)
})

void test("a rejecting audit hook cannot change the action result", async () => {
  const errors: CallErrorEvent[] = []
  const runtime = new Genui({
    onError: (event) => {
      errors.push(event)
    },
    onCall: async () => {
      throw new Error("Audit backend rejected")
    },
    actions: [
      action({
        name: "profile.read",
        description: "Read a profile.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ name: "Ada" }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["profile.read"] })

  assert.deepEqual(
    await runtime.execute(
      { surfaceId: surface.id, callId: "call-1", action: "profile.read", input: {} },
      {},
    ),
    { ok: true, value: { name: "Ada" } },
  )
  await Promise.resolve()
  assert.equal(errors[0]?.phase, "audit")
  assert.match(String(errors[0]?.cause), /Audit backend rejected/)
})

void test("audit marks unregistered action effects as unknown", async () => {
  const entries: CallAuditEntry[] = []
  const runtime = new Genui({
    actions: [],
    onCall: (entry) => {
      entries.push(entry)
    },
  })
  const surface = await runtime.surface({ content: "", actions: [] })

  const result = await runtime.execute(
    { surfaceId: surface.id, callId: "call-1", action: "missing.action", input: {} },
    {},
  )

  assert.equal(result.ok ? undefined : result.error.code, "not_granted")
  assert.equal(entries[0]?.effect, "unknown")
  assert.equal(entries[0]?.outcome, "not_granted")
})

void test("audit records each idempotent replay while the effect executes once", async () => {
  const entries: CallAuditEntry[] = []
  let executions = 0
  const runtime = new Genui({
    onCall: (entry) => {
      entries.push(entry)
    },
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        policy: "allow",
        input: emptyInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["notes.create"] })
  const call = { surfaceId: surface.id, callId: "call-1", action: "notes.create", input: {} }

  await runtime.execute(call, {})
  await runtime.execute(call, {})

  assert.equal(executions, 1)
  assert.deepEqual(
    entries.map((entry) => entry.outcome),
    ["ok", "ok"],
  )
})
