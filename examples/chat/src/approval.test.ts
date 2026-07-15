import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ActionCall } from "genui/protocol"
import { executeGeneratedUiAction, generatedUi } from "./ai/genui.js"
import {
  createPendingApprovals,
  parseApprovalExchangeRequest,
  parseApprovalResponse,
  parseExecuteEnvelope,
  parseExecuteRequest,
} from "./approval.js"
import { approvalScenarios } from "./approval-scenarios.js"
import { JsonPreferenceStore } from "./preferences.js"

void test("preferences.save requires approval and replays one completed result", async (context) => {
  const filePath = join(tmpdir(), `genui-preference-${randomUUID()}.json`)
  context.after(() => rm(filePath, { force: true }))
  const preferences = new JsonPreferenceStore(filePath)
  const surface = await generatedUi.createSurface({
    content: "<p>Trips</p>",
    subject: "test-subject",
  })
  const descriptor = surface.grant.actions.find((action) => action.name === "preferences.save")
  assert.equal(descriptor?.effect, "write")
  assert.equal(descriptor?.requiresApproval, true)

  const call = {
    surfaceId: surface.id,
    callId: "save-preference",
    action: "preferences.save",
    input: { preference: "  Mountain escape  " },
  } satisfies ActionCall
  assert.deepEqual(
    await executeGeneratedUiAction(call, preferences, "test-subject", () => undefined),
    {
      ok: false,
      error: {
        code: "approval_required",
        message: 'Save "Mountain escape" as your preferred trip',
      },
    },
  )
  assert.deepEqual(await executeGeneratedUiAction(call, preferences, "test-subject", () => true), {
    ok: true,
    value: { preference: "Mountain escape" },
  })
  assert.deepEqual(await executeGeneratedUiAction(call, preferences, "test-subject", () => false), {
    ok: true,
    value: { preference: "Mountain escape" },
  })

  const deniedCall = { ...call, callId: "save-denied" }
  assert.deepEqual(
    await executeGeneratedUiAction(deniedCall, preferences, "test-subject", () => false),
    {
      ok: false,
      error: { code: "approval_denied", message: "Action was denied." },
    },
  )
})

void test("CHAT-APR-001 and CHAT-APR-005 bind a kernel-created pending approval to one retry", () => {
  const approvals = createPendingApprovals()
  const call = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "preferences.save",
    input: { preference: "Mountain escape" },
  } satisfies ActionCall

  assert.ok(approvalScenarios.some((scenario) => scenario.id === "CHAT-APR-001"))
  assert.ok(approvalScenarios.some((scenario) => scenario.id === "CHAT-APR-005"))
  assert.equal(approvals.check({ subject: "owner", call, input: call.input }), "pending")
  const pending = approvals.pending(call, "owner")
  assert.equal(typeof pending?.token, "string")
  assert.equal(
    approvals.check({ subject: "owner", call, input: call.input, retryToken: "wrong" }),
    "rejected",
  )
  assert.equal(
    approvals.check({ subject: "owner", call, input: { preference: "City" } }),
    "rejected",
  )
  assert.ok(pending)
  const retryToken = approvals.exchange(pending, "owner")
  assert.equal(typeof retryToken, "string")
  if (typeof retryToken !== "string") throw new Error("Expected retry token.")
  assert.notEqual(retryToken, pending.token)
  assert.equal(approvals.exchange(pending, "owner"), undefined)
  assert.equal(
    approvals.check({ subject: "owner", call, input: call.input, retryToken }),
    "approved",
  )
  assert.equal(
    approvals.check({ subject: "owner", call, input: call.input, retryToken }),
    "rejected",
  )

  assert.deepEqual(parseExecuteRequest({ call, approved: true }), undefined)
  assert.deepEqual(parseApprovalExchangeRequest({ pendingApproval: pending }), {
    pendingApproval: pending,
  })
  assert.deepEqual(parseApprovalResponse({ retryToken }), { retryToken })
  assert.equal(
    parseExecuteEnvelope(
      {
        result: { ok: false, error: { code: "approval_required", message: "Confirm" } },
      },
      call,
    ),
    undefined,
  )
})

void test("CHAT-APR-004 keeps pending authority when the action binding mismatches", () => {
  const approvals = createPendingApprovals()
  const call = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "preferences.save",
    input: { preference: "City" },
  } satisfies ActionCall

  assert.ok(approvalScenarios.some((scenario) => scenario.id === "CHAT-APR-004"))
  assert.equal(approvals.check({ subject: "owner", call, input: call.input }), "pending")
  const pending = approvals.pending(call, "owner")
  assert.ok(pending)
  assert.deepEqual(pending, { ...call, token: pending.token })
  assert.equal(approvals.exchange({ ...pending, action: "preferences.delete" }, "owner"), false)
  assert.equal(typeof approvals.exchange(pending, "owner"), "string")
})

void test("CHAT-APR-002 and CHAT-APR-011 reject forged and malformed approval fields", () => {
  const approvals = createPendingApprovals()
  const call = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "preferences.save",
    input: { preference: "City" },
  } satisfies ActionCall

  assert.ok(approvalScenarios.some((scenario) => scenario.id === "CHAT-APR-002"))
  assert.ok(approvalScenarios.some((scenario) => scenario.id === "CHAT-APR-011"))
  assert.equal(
    approvals.check({ subject: "owner", call, input: call.input, retryToken: "guest-token" }),
    "rejected",
  )
  assert.equal(approvals.pending(call, "owner"), undefined)

  const malformedExecuteRequests: readonly unknown[] = [
    {},
    { call, approved: true },
    { call, pendingApproval: { token: "guest-token" } },
    { call, approvalRetryToken: 1 },
    { call, approvalRetryToken: "" },
    { call: { ...call, extra: true } },
    { call: { ...call, surfaceId: "" } },
    { call: { ...call, surfaceId: 1 } },
    { call: { ...call, callId: "" } },
    { call: { ...call, callId: null } },
    { call: { ...call, action: "invalid" } },
    { call: { ...call, action: false } },
    { call: { surfaceId: call.surfaceId, callId: call.callId, action: call.action } },
  ]
  for (const request of malformedExecuteRequests)
    assert.equal(parseExecuteRequest(request), undefined)
  for (const missing of ["surfaceId", "callId", "action", "input"] as const) {
    const incompleteCall = Object.fromEntries(
      Object.entries(call).filter(([field]) => field !== missing),
    )
    assert.equal(parseExecuteRequest({ call: incompleteCall }), undefined, missing)
  }

  assert.equal(approvals.check({ subject: "owner", call, input: call.input }), "pending")
  const pending = approvals.pending(call, "owner")
  assert.ok(pending)
  const malformedExchanges: readonly unknown[] = [
    {},
    { pendingApproval: pending, extra: true },
    { pendingApproval: { ...pending, token: "" } },
    { pendingApproval: { ...pending, token: 1 } },
    { pendingApproval: { ...pending, surfaceId: "" } },
    { pendingApproval: { ...pending, surfaceId: 1 } },
    { pendingApproval: { ...pending, callId: "" } },
    { pendingApproval: { ...pending, callId: null } },
    { pendingApproval: { ...pending, action: "invalid" } },
    { pendingApproval: { ...pending, action: false } },
    { pendingApproval: { ...pending, input: undefined } },
    { pendingApproval: { ...pending, extra: true } },
  ]
  for (const request of malformedExchanges)
    assert.equal(parseApprovalExchangeRequest(request), undefined)
  for (const missing of ["surfaceId", "callId", "action", "input", "token"] as const) {
    const incompletePending: Readonly<Record<string, unknown>> = Object.fromEntries(
      Object.entries(pending).filter(([field]) => field !== missing),
    )
    assert.equal(
      parseApprovalExchangeRequest({ pendingApproval: incompletePending }),
      undefined,
      missing,
    )
  }

  for (const response of [
    {},
    { retryToken: "" },
    { retryToken: 1 },
    { retryToken: "x", extra: true },
  ])
    assert.equal(parseApprovalResponse(response), undefined)
  const approvalRequired = {
    result: { ok: false, error: { code: "approval_required", message: "Confirm" } },
    pendingApproval: pending,
  }
  assert.deepEqual(parseExecuteEnvelope(approvalRequired, call), approvalRequired)
  assert.equal(
    parseExecuteEnvelope(
      { ...approvalRequired, pendingApproval: { ...pending, surfaceId: "other-surface" } },
      call,
    ),
    undefined,
  )
  assert.equal(
    parseExecuteEnvelope(
      { ...approvalRequired, pendingApproval: { ...pending, callId: "other-call" } },
      call,
    ),
    undefined,
  )
  assert.equal(
    parseExecuteEnvelope(
      { ...approvalRequired, pendingApproval: { ...pending, action: "preferences.delete" } },
      call,
    ),
    undefined,
  )
  assert.equal(typeof approvals.exchange(pending, "owner"), "string")
})

void test("CHAT-APR-003 rejects a caller whose authenticated subject does not own the surface", async () => {
  const scenario = approvalScenarios.find((candidate) => candidate.id === "CHAT-APR-003")
  assert.ok(scenario)
  const filePath = join(tmpdir(), `genui-preference-${randomUUID()}.json`)
  const surface = await generatedUi.createSurface({ content: "<p>Trips</p>", subject: "owner" })
  const result = await executeGeneratedUiAction(
    {
      surfaceId: surface.id,
      callId: "wrong-subject",
      action: "preferences.save",
      input: { preference: "City" },
    },
    new JsonPreferenceStore(filePath),
    "other",
  )
  assert.deepEqual(result, {
    ok: false,
    error: { code: "not_granted", message: "Surface is not granted to this subject." },
  })
  await rm(filePath, { force: true })
})
