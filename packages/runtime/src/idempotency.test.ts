import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"
import type { Effect, SurfaceStore } from "./types.js"

const valueInput = testSchema<Readonly<{ value: string }>>((input) =>
  isRecord(input) && typeof input.value === "string"
    ? { ok: true, value: { value: input.value } }
    : { ok: false, message: "Expected a value." },
)

const objectInput = testSchema<Readonly<Record<string, unknown>>>((input) =>
  isRecord(input) ? { ok: true, value: input } : { ok: false, message: "Expected an object." },
)

const canonicalTextInput = testSchema<Readonly<{ text: string }>>((input) =>
  isRecord(input) && typeof input.text === "string"
    ? { ok: true, value: { text: input.text.trim() } }
    : { ok: false, message: "Expected text." },
)

for (const effect of ["write", "dangerous"] satisfies readonly Effect[]) {
  void test(`call id makes ${effect} actions idempotent`, async () => {
    let approvals = 0
    let executions = 0
    let release: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const runtime = new Genui({
      actions: [
        action({
          name: "records.change",
          description: "Change a record.",
          effect,
          input: valueInput,
          execute: async (_context, input) => {
            executions += 1
            markStarted?.()
            await gate
            return { execution: executions, value: input.value }
          },
        }),
      ],
    })
    const surface = await runtime.surface({
      content: "<button>Change</button>",
      actions: ["records.change"],
    })
    const call = {
      surfaceId: surface.id,
      callId: "call-stable",
      action: "records.change",
      input: { value: "first" },
    }
    const approve = () => {
      approvals += 1
      return true
    }

    const first = runtime.execute(call, {}, { approve })
    const duplicate = runtime.execute(call, {}, { approve })
    await started
    await Promise.resolve()
    release?.()

    assert.deepEqual(await Promise.all([first, duplicate]), [
      { ok: true, value: { execution: 1, value: "first" } },
      { ok: true, value: { execution: 1, value: "first" } },
    ])
    assert.equal(approvals, 1)
    assert.equal(executions, 1)

    assert.deepEqual(await runtime.execute(call, {}, { approve }), {
      ok: true,
      value: { execution: 1, value: "first" },
    })
    assert.equal(approvals, 1)
    assert.equal(executions, 1)

    const conflict = await runtime.execute(
      { ...call, input: { value: "different" } },
      {},
      { approve },
    )
    assert.equal(conflict.ok ? undefined : conflict.error.code, "invalid_input")
    assert.equal(approvals, 1)
    assert.equal(executions, 1)
  })
}

void test("idempotency ignores recursive JSON object key order", async () => {
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "records.change",
        description: "Change a record.",
        effect: "write",
        policy: "allow",
        input: objectInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["records.change"] })
  const call = {
    surfaceId: surface.id,
    callId: "call-reordered",
    action: "records.change",
  }

  const first = await runtime.execute(
    {
      ...call,
      input: {
        name: "same",
        nested: { first: 1, second: 2 },
        rows: [{ left: true, right: false }],
      },
    },
    {},
  )
  const reordered = await runtime.execute(
    {
      ...call,
      input: {
        rows: [{ right: false, left: true }],
        nested: { second: 2, first: 1 },
        name: "same",
      },
    },
    {},
  )

  assert.deepEqual(first, { ok: true, value: { execution: 1 } })
  assert.deepEqual(reordered, first)
  assert.equal(executions, 1)
})

void test("approval-required retries execute an effectful call exactly once", async () => {
  let approval: boolean | undefined
  let approvalChecks = 0
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "notes.create",
        description: "Create a note.",
        effect: "write",
        intent: "Create note {input.text}",
        input: canonicalTextInput,
        execute: (_context, input) => ({ execution: ++executions, text: input.text }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["notes.create"] })
  const call = {
    surfaceId: surface.id,
    callId: "call-pending-approval",
    action: "notes.create",
    input: { text: "  hello  " },
  }
  const approve = () => {
    approvalChecks += 1
    return approval
  }

  assert.deepEqual(await runtime.execute(call, {}, { approve }), {
    ok: false,
    error: { code: "approval_required", message: "Create note hello" },
  })
  assert.equal(approvalChecks, 1)
  assert.equal(executions, 0)

  approval = true
  const approved = await runtime.execute(call, {}, { approve })
  assert.deepEqual(approved, { ok: true, value: { execution: 1, text: "hello" } })
  assert.deepEqual(await runtime.execute(call, {}, { approve }), approved)
  assert.equal(approvalChecks, 2)
  assert.equal(executions, 1)
})

void test("read actions are not deduplicated by call id", async () => {
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "records.read",
        description: "Read a record.",
        effect: "read",
        input: valueInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "<button>Read</button>",
    actions: ["records.read"],
  })
  const call = {
    surfaceId: surface.id,
    callId: "call-repeat",
    action: "records.read",
    input: { value: "same" },
  }

  assert.deepEqual(await runtime.execute(call, {}), { ok: true, value: { execution: 1 } })
  assert.deepEqual(await runtime.execute(call, {}), { ok: true, value: { execution: 2 } })
})

void test("effectful call ids replay authoritative denials", async () => {
  let approvals = 0
  let executions = 0
  const runtime = new Genui({
    actions: [
      action({
        name: "records.change",
        description: "Change a record.",
        effect: "write",
        input: valueInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["records.change"] })
  const call = {
    surfaceId: surface.id,
    callId: "call-denied",
    action: "records.change",
    input: { value: "first" },
  }

  const denied = await runtime.execute(
    call,
    {},
    {
      approve: () => {
        approvals += 1
        return false
      },
    },
  )
  const replay = await runtime.execute(
    call,
    {},
    {
      approve: () => {
        approvals += 1
        return true
      },
    },
  )

  assert.equal(denied.ok ? undefined : denied.error.code, "approval_denied")
  assert.deepEqual(replay, denied)
  assert.equal(approvals, 1)
  assert.equal(executions, 0)
})

void test("memory store expires completed idempotency entries", async () => {
  const store = memoryStore()
  let operations = 0
  const request = {
    surfaceId: "surface-1",
    callId: "call-1",
    fingerprint: "records.change\n{}",
    windowMs: 0,
  }
  const operation = async () => ({ ok: true as const, value: ++operations })

  assert.equal((await store.runIdempotent(request, operation)).status, "result")
  assert.equal((await store.runIdempotent(request, operation)).status, "result")
  assert.equal(operations, 2)
})

void test("idempotency store failures return storage_unavailable", async () => {
  const backing = memoryStore()
  const store = {
    get: (id: string) => backing.get(id),
    set: (record: Parameters<SurfaceStore["set"]>[0]) => backing.set(record),
    revoke: (id: string) => backing.revoke(id),
    runIdempotent: () => {
      throw new Error("idempotency backend unavailable")
    },
  } satisfies SurfaceStore
  let executions = 0
  const runtime = new Genui({
    store,
    actions: [
      action({
        name: "records.change",
        description: "Change a record.",
        effect: "write",
        policy: "allow",
        input: valueInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["records.change"] })
  const result = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-1",
      action: "records.change",
      input: { value: "first" },
    },
    {},
  )

  assert.equal(result.ok ? undefined : result.error.code, "storage_unavailable")
  assert.equal(executions, 0)
})
