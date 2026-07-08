import assert from "node:assert/strict"
import { test } from "node:test"
import { pendingResultState, resultStateFromActionResult } from "./result-state.js"

void test("result state owns pending, complete, and error transitions", () => {
  assert.deepEqual(pendingResultState(undefined), { status: "pending" })
  assert.deepEqual(pendingResultState({ status: "complete", value: { total: 6 } }), {
    status: "pending",
    value: { total: 6 },
  })
  assert.deepEqual(resultStateFromActionResult({ ok: true, value: { total: 6 } }), {
    status: "complete",
    value: { total: 6 },
  })
  assert.deepEqual(
    resultStateFromActionResult({
      ok: false,
      error: { code: "not_granted", message: "Capability is not granted." },
    }),
    { status: "error", error: "Capability is not granted." },
  )
})
