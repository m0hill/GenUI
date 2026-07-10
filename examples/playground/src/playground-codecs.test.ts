import assert from "node:assert/strict"
import { test } from "node:test"
import {
  parseApprovalRequest,
  parseApprovalResponse,
  parseExecuteEnvelope,
  parseExecuteRequest,
  parsePlaygroundEvent,
  parseSubscriptionOpenFailure,
  type PlaygroundEvent,
} from "./playground-codecs.js"

void test("subscription open failures are decoded strictly", () => {
  const failure = {
    ok: false,
    error: { code: "not_granted", message: "Subscription is not granted." },
  } as const

  assert.deepEqual(parseSubscriptionOpenFailure(failure), failure)
  assert.equal(parseSubscriptionOpenFailure({ ...failure, unexpected: true }), undefined)
  assert.equal(
    parseSubscriptionOpenFailure({
      ...failure,
      error: { code: "unknown", message: failure.error.message },
    }),
    undefined,
  )
  assert.equal(parseSubscriptionOpenFailure({ ok: true, error: failure.error }), undefined)
  const inheritedOk = Object.assign(Object.create({ ok: false }), {
    error: failure.error,
    unexpected: true,
  })
  assert.equal(parseSubscriptionOpenFailure(inheritedOk), undefined)
})

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
  const approval = {
    result: {
      ok: false,
      error: { code: "approval_required", message: "Approve this operation." },
    },
    audit: [],
    approvalToken: "approval-token",
  }
  assert.deepEqual(parseExecuteEnvelope(approval), approval)
  assert.equal(parseExecuteEnvelope({ ...approval, approvalToken: undefined }), undefined)
  assert.equal(parseExecuteEnvelope({ ...value, approvalToken: "unexpected" }), undefined)
})

void test("approval retries require string tokens on both trusted requests", () => {
  const call = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "profile.write",
    input: {},
  }
  assert.deepEqual(parseExecuteRequest({ call }), { call })
  assert.deepEqual(parseExecuteRequest({ call, approvalRetryToken: "retry-token-1" }), {
    call,
    approvalRetryToken: "retry-token-1",
  })
  assert.equal(parseExecuteRequest({ call, approvalRetryToken: true }), undefined)
  assert.deepEqual(
    parseApprovalRequest({ surfaceId: "surface-1", callId: "call-1", token: "token-1" }),
    { surfaceId: "surface-1", callId: "call-1", token: "token-1" },
  )
  assert.equal(parseApprovalRequest({ surfaceId: "surface-1", callId: "call-1" }), undefined)
  assert.deepEqual(parseApprovalResponse({ retryToken: "retry-token-1" }), {
    retryToken: "retry-token-1",
  })
  assert.equal(parseApprovalResponse({ retryToken: false }), undefined)
})

void test("playground events parse at the serialized log boundary", () => {
  const events = [
    {
      type: "call",
      call: {
        surfaceId: "surface-1",
        callId: "call-1",
        action: "profile.read",
        input: { id: "profile-1" },
      },
    },
    {
      type: "result",
      callId: "call-1",
      action: "profile.read",
      result: { ok: true, value: { name: "Ada" } },
    },
    {
      type: "capability_call",
      call: {
        surfaceId: "surface-1",
        callId: "capability-1",
        capability: "sendMessage",
      },
      payloadBytes: 24,
    },
    {
      type: "capability_result",
      callId: "capability-1",
      capability: "sendMessage",
      outcome: "ok",
    },
    {
      type: "host_capability",
      capability: "sendMessage",
      provenance: "generated_surface",
      role: "user",
      textLength: 24,
    },
    {
      type: "host_capability",
      capability: "updateModelContext",
      provenance: "generated_surface",
      contentLength: 26,
      structuredContentKeys: ["selectedRows"],
    },
    {
      type: "host_capability",
      capability: "openLink",
      provenance: "generated_surface",
      url: "https://example.com/docs",
    },
    {
      type: "host_teardown",
      reason: "surface_replaced",
      snapshotCaptured: false,
    },
    { type: "resize", width: 480.5, height: 320.25 },
    { type: "guest_error", message: "Guest failed.", stack: "stack" },
    { type: "violation", reason: "ungranted_call", detail: "private.read" },
    {
      type: "violation",
      reason: "teardown_timeout",
      detail: "Surface teardown timed out after 1000ms.",
    },
    {
      type: "audit",
      entry: {
        surfaceId: "surface-1",
        callId: "call-1",
        action: "profile.read",
        effect: "read",
        outcome: "ok",
        at: 1_000,
      },
    },
    {
      type: "subscription_start",
      surfaceId: "surface-1",
      subscriptionId: "subscription-1",
      subscription: "orders.changes",
      inputBytes: 23,
    },
    {
      type: "subscription_opened",
      surfaceId: "surface-1",
      subscriptionId: "subscription-1",
      subscription: "orders.changes",
    },
    {
      type: "subscription_event",
      surfaceId: "surface-1",
      subscriptionId: "subscription-1",
      subscription: "orders.changes",
      sequence: 1,
      payloadBytes: 48,
    },
    {
      type: "subscription_closed",
      surfaceId: "surface-1",
      subscriptionId: "subscription-1",
      subscription: "orders.changes",
      reason: "unsubscribed",
      eventCount: 1,
      payloadBytes: 48,
      durationMs: 250,
    },
  ] satisfies readonly PlaygroundEvent[]

  assert.deepEqual(events.map(parsePlaygroundEvent), events)
  assert.equal(
    parsePlaygroundEvent({ ...events[0], call: { ...events[0].call, callId: undefined } }),
    undefined,
  )
  assert.equal(
    parsePlaygroundEvent({ ...events[1], result: { ok: false, error: { code: "unknown" } } }),
    undefined,
  )
  assert.equal(parsePlaygroundEvent({ ...events[2], payloadBytes: -1 }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[3], outcome: "unknown" }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[4], textLength: "24" }), undefined)
  assert.equal(
    parsePlaygroundEvent({ ...events[5], structuredContentKeys: ["selectedRows", false] }),
    undefined,
  )
  assert.equal(parsePlaygroundEvent({ ...events[6], provenance: "user" }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[7], snapshotCaptured: "no" }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[8], width: undefined }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[8], height: Number.POSITIVE_INFINITY }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[13], inputBytes: -1 }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[14], subscriptionId: undefined }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[15], sequence: 0 }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[15], payload: { private: true } }), undefined)
  assert.equal(parsePlaygroundEvent({ ...events[16], reason: "unknown" }), undefined)
})
