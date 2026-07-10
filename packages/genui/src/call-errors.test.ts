import assert from "node:assert/strict"
import { test } from "node:test"
import { action, type CallErrorEvent, Genui } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { SurfaceStore } from "./types.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "Expected an object." },
)

void test("onError receives action failures hidden from the caller", async () => {
  const cause = new Error("Database connection failed")
  const errors: CallErrorEvent[] = []
  const runtime = new Genui({
    onError: (event) => {
      if (event.type === "call") errors.push(event)
    },
    actions: [
      action({
        name: "profile.read",
        description: "Read a profile.",
        effect: "read",
        input: emptyInput,
        execute: () => {
          throw cause
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
    { surfaceId: surface.id, callId: "call-1", action: "profile.read", input: {} },
    {},
    { subject: "session-1" },
  )

  assert.deepEqual(result, {
    ok: false,
    error: { code: "execution_failed", message: "Action failed." },
  })
  assert.deepEqual(errors, [
    {
      type: "call",
      surfaceId: surface.id,
      callId: "call-1",
      subject: "session-1",
      action: "profile.read",
      phase: "action",
      cause,
    },
  ])
})

void test("onError identifies validation, approval, and storage failure phases", async () => {
  const errors: CallErrorEvent[] = []
  const inputCause = new Error("Input validator crashed")
  const approvalCause = new Error("Approval backend failed")
  const backing = memoryStore()
  let failReads = false
  const store = {
    get: (id: string) => {
      if (failReads) throw new Error("Surface database failed")
      return backing.get(id)
    },
    set: (record: Parameters<SurfaceStore["set"]>[0]) => backing.set(record),
    revoke: (id: string) => backing.revoke(id),
    runIdempotent: (request, operation) => backing.runIdempotent(request, operation),
  } satisfies SurfaceStore
  const runtime = new Genui({
    store,
    onError: (event) => {
      if (event.type === "call") errors.push(event)
    },
    actions: [
      action({
        name: "records.validate",
        description: "Validate a record.",
        effect: "read",
        input: testSchema(() => {
          throw inputCause
        }),
        execute: () => ({}),
      }),
      action({
        name: "records.create",
        description: "Create a record.",
        effect: "write",
        input: emptyInput,
        execute: () => ({}),
      }),
      action({
        name: "records.output",
        description: "Return a record.",
        effect: "read",
        input: emptyInput,
        output: testSchema(() => ({ ok: false, message: "Expected a record." })),
        execute: () => null,
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "",
    actions: ["records.validate", "records.create", "records.output"],
  })

  await runtime.execute(
    { surfaceId: surface.id, callId: "input", action: "records.validate", input: {} },
    {},
  )
  await runtime.execute(
    { surfaceId: surface.id, callId: "approval", action: "records.create", input: {} },
    {},
    {
      approve: () => {
        throw approvalCause
      },
    },
  )
  await runtime.execute(
    { surfaceId: surface.id, callId: "output", action: "records.output", input: {} },
    {},
  )
  failReads = true
  await runtime.execute(
    { surfaceId: surface.id, callId: "store", action: "records.output", input: {} },
    {},
  )

  assert.deepEqual(
    errors.map((event) => ({ callId: event.callId, phase: event.phase })),
    [
      { callId: "input", phase: "input_validation" },
      { callId: "approval", phase: "approval" },
      { callId: "output", phase: "output_validation" },
      { callId: "store", phase: "surface_store" },
    ],
  )
  assert.equal(errors[0]?.cause, inputCause)
  assert.equal(errors[1]?.cause, approvalCause)
  assert.match(String(errors[2]?.cause), /Expected a record/)
  assert.match(String(errors[3]?.cause), /Surface database failed/)
})

void test("onError failures cannot change action results", async () => {
  const runtime = new Genui({
    onError: () => {
      throw new Error("Diagnostic backend failed")
    },
    actions: [
      action({
        name: "profile.read",
        description: "Read a profile.",
        effect: "read",
        input: emptyInput,
        execute: () => {
          throw new Error("Action failed")
        },
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["profile.read"] })

  assert.deepEqual(
    await runtime.execute(
      { surfaceId: surface.id, callId: "call-1", action: "profile.read", input: {} },
      {},
    ),
    { ok: false, error: { code: "execution_failed", message: "Action failed." } },
  )
})
