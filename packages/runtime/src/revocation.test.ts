import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui } from "./registry.js"
import { memoryStore } from "./surface-runtime.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

const emptyInput = testSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "Expected an object." },
)

void test("expired surface grant rejects execution and removes its authority", async () => {
  const store = memoryStore()
  let executions = 0
  const runtime = new Genui({
    store,
    actions: [
      action({
        name: "records.read",
        description: "Read records.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({
    content: "",
    actions: ["records.read"],
    ttlMs: 0,
  })

  assert.equal(typeof surface.grant.expiresAt, "number")
  const result = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-after-expiry",
      action: "records.read",
      input: {},
    },
    {},
  )

  assert.equal(result.ok ? undefined : result.error.code, "unknown_surface")
  assert.equal(executions, 0)
  assert.equal(await store.get(surface.id), undefined)
})

void test("explicit revocation rejects later calls without executing the action", async () => {
  const store = memoryStore()
  let executions = 0
  const runtime = new Genui({
    store,
    actions: [
      action({
        name: "records.read",
        description: "Read records.",
        effect: "read",
        input: emptyInput,
        execute: () => ({ execution: ++executions }),
      }),
    ],
  })
  const surface = await runtime.surface({ content: "", actions: ["records.read"] })

  await runtime.revoke(surface.id)
  const result = await runtime.execute(
    {
      surfaceId: surface.id,
      callId: "call-after-revoke",
      action: "records.read",
      input: {},
    },
    {},
  )

  assert.equal(result.ok ? undefined : result.error.code, "unknown_surface")
  assert.equal(executions, 0)
  assert.equal(await store.get(surface.id), undefined)
})

void test("revoking a surface clears its completed idempotency entries", async () => {
  const store = memoryStore()
  const request = {
    surfaceId: "surface-1",
    callId: "call-1",
    fingerprint: "records.change\n{}",
    windowMs: 60_000,
  }
  let operations = 0
  const operation = async () => ({ ok: true as const, value: ++operations })

  await store.runIdempotent(request, operation)
  await store.revoke(request.surfaceId)
  await store.runIdempotent(request, operation)

  assert.equal(operations, 2)
})
