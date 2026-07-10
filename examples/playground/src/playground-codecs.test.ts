import assert from "node:assert/strict"
import { test } from "node:test"
import {
  parseExecuteEnvelope,
  parsePlaygroundEvent,
  type PlaygroundEvent,
} from "./playground-codecs.js"

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
    { type: "resize", height: 320 },
    { type: "guest_error", message: "Guest failed.", stack: "stack" },
    { type: "violation", reason: "ungranted_call", detail: "private.read" },
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
})
