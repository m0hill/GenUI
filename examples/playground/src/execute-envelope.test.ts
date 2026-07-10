import assert from "node:assert/strict"
import { test } from "node:test"
import { parseExecuteEnvelope } from "./execute-envelope.js"

void test("execute envelope parses action results and audit entries", () => {
  const value = {
    result: { ok: true, value: { name: "Ada" } },
    audit: [
      {
        surfaceId: "surface-1",
        callId: "call-1",
        subject: "session-1",
        action: "profile.read",
        effect: "read",
        outcome: "ok",
        at: 1_000,
      },
    ],
  }

  assert.deepEqual(parseExecuteEnvelope(value), value)
  assert.equal(parseExecuteEnvelope({ ...value, result: { ok: "yes" } }), undefined)
  assert.equal(
    parseExecuteEnvelope({
      ...value,
      audit: [{ ...value.audit[0], outcome: "not-an-outcome" }],
    }),
    undefined,
  )
})
