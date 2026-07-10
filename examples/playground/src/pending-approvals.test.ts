import assert from "node:assert/strict"
import { test } from "node:test"
import { createPendingApprovals } from "./pending-approvals.js"

void test("pending approval is one-shot and bound to subject, action, and canonical input", () => {
  const approvals = createPendingApprovals()
  const request = {
    surfaceId: "surface-1",
    callId: "call-1",
    subject: "session-1",
    action: "orders.update_status",
    input: { id: "ord-1001", status: "shipped" },
  }

  assert.equal(approvals.check(request), undefined)
  const token = approvals.token(request)
  assert.equal(typeof token, "string")
  assert.equal(
    approvals.approve({
      surfaceId: request.surfaceId,
      callId: request.callId,
      subject: "session-2",
      token: token ?? "",
    }),
    false,
  )
  const retryToken = approvals.approve({
    surfaceId: request.surfaceId,
    callId: request.callId,
    subject: request.subject,
    token: token ?? "",
  })
  assert.equal(typeof retryToken, "string")
  assert.equal(approvals.approve({ ...request, token: token ?? "" }), undefined)
  assert.equal(approvals.check({ ...request, action: "orders.cancel" }), false)
  assert.equal(approvals.check({ ...request, retryToken: "wrong-token" }), false)
  assert.equal(
    approvals.check({
      ...request,
      input: { status: "shipped", id: "ord-1001" },
      retryToken: typeof retryToken === "string" ? retryToken : undefined,
    }),
    true,
  )
  assert.equal(approvals.check(request), undefined)
})

void test("pending approval rejects preapproval and expires without a timer", () => {
  let now = 0
  const approvals = createPendingApprovals({ now: () => now, lifetimeMs: 1_000 })
  const key = { surfaceId: "surface-1", callId: "call-1", subject: "session-1" }

  assert.equal(approvals.approve({ ...key, token: "not-issued" }), undefined)
  assert.equal(
    approvals.check({ ...key, action: "orders.update_status", input: { id: "ord-1001" } }),
    undefined,
  )
  const token = approvals.token(key)
  assert.equal(typeof token, "string")
  now = 1_001
  assert.equal(approvals.approve({ ...key, token: token ?? "" }), undefined)
})
