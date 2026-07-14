import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ActionCall } from "genui/protocol"
import { executeGeneratedUiAction, generatedUi } from "./ai/genui.js"
import { parseExecuteEnvelope, parseExecuteRequest, pendingApprovals } from "./approval.js"
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

void test("approval tokens bind one retry to the original call and input", () => {
  pendingApprovals.clear()
  const call = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "preferences.save",
    input: { preference: "Mountain escape" },
  } satisfies ActionCall

  assert.equal(pendingApprovals.check({ call, input: call.input }), undefined)
  const approvalToken = pendingApprovals.token(call)
  assert.equal(typeof approvalToken, "string")
  assert.equal(pendingApprovals.check({ call, input: call.input, token: "wrong" }), false)
  assert.equal(
    pendingApprovals.check({ call, input: { preference: "City" }, token: approvalToken }),
    false,
  )
  assert.equal(
    pendingApprovals.check({
      call,
      input: call.input,
      token: approvalToken,
    }),
    true,
  )
  assert.equal(pendingApprovals.token(call), undefined)

  assert.deepEqual(parseExecuteRequest({ call, approved: true }), { call })
  assert.equal(
    parseExecuteEnvelope({
      result: { ok: false, error: { code: "approval_required", message: "Confirm" } },
    }),
    undefined,
  )
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
