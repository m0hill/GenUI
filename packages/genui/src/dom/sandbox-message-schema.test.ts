import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import { parseSandboxMessage } from "./sandbox-message-schema.js"

void test("sandbox message schema parses code calls and runtime reports", () => {
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      surfaceId: "surface-1",
      callId: "call-1",
      action: "dice.roll",
      input: { sides: 6 },
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        surfaceId: "surface-1",
        callId: "call-1",
        action: "dice.roll",
        input: { sides: 6 },
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-1",
      ok: true,
      value: { count: 4 },
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "teardown",
        surfaceId: "surface-1",
        requestId: "teardown-1",
        ok: true,
        value: { count: 4 },
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-2",
      ok: true,
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "teardown",
        surfaceId: "surface-1",
        requestId: "teardown-2",
        ok: true,
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-3",
      ok: false,
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "teardown",
        surfaceId: "surface-1",
        requestId: "teardown-3",
        ok: false,
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "heartbeat",
      surfaceId: "surface-1",
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "heartbeat",
        surfaceId: "surface-1",
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "resize",
      surfaceId: "surface-1",
      height: 320,
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "resize",
        surfaceId: "surface-1",
        height: 320,
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "guest_error",
      surfaceId: "surface-1",
      message: "Guest failed",
      stack: "guest.js:1",
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "guest_error",
        surfaceId: "surface-1",
        message: "Guest failed",
        stack: "guest.js:1",
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "snapshot",
      surfaceId: "surface-1",
      requestId: "snapshot-1",
      ok: true,
      value: { count: 3 },
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "snapshot",
        surfaceId: "surface-1",
        requestId: "snapshot-1",
        ok: true,
        value: { count: 3 },
      },
    },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "snapshot",
      surfaceId: "surface-1",
      requestId: "snapshot-2",
      ok: false,
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "snapshot",
        surfaceId: "surface-1",
        requestId: "snapshot-2",
        ok: false,
      },
    },
  )
})

void test("sandbox message schema parses a send-message capability call", () => {
  const message = {
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: "surface-1",
    callId: "capability-1",
    capability: "ui/message",
    params: {
      role: "user",
      content: { type: "text", text: "Show the selected orders" },
    },
  }

  assert.deepEqual(parseSandboxMessage(message), { ok: true, value: message })
})

void test("sandbox message schema parses an open-link capability call", () => {
  const message = {
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: "surface-1",
    callId: "capability-2",
    capability: "ui/open-link",
    params: { url: "https://example.com/orders" },
  }

  assert.deepEqual(parseSandboxMessage(message), { ok: true, value: message })
})

void test("sandbox message schema parses a model-context capability call", () => {
  const message = {
    channel: protocolChannel,
    type: "capability_call",
    surfaceId: "surface-1",
    callId: "capability-3",
    capability: "ui/update-model-context",
    params: {
      content: "Rows 2 and 5 are selected.",
      structuredContent: { selectedRows: [2, 5] },
    },
  }

  assert.deepEqual(parseSandboxMessage(message), { ok: true, value: message })
})

void test("sandbox message schema rejects malformed boundary data", () => {
  assert.deepEqual(parseSandboxMessage("bad"), { ok: false, reason: "bad_message" })
  assert.deepEqual(parseSandboxMessage({ channel: "wrong" }), {
    ok: false,
    reason: "unknown_channel",
  })

  const longIdentifier = "x".repeat(257)
  for (const message of [
    { channel: protocolChannel, type: "resize", surfaceId: "surface-1", height: Number.NaN },
    { channel: protocolChannel, type: "resize", surfaceId: longIdentifier, height: 100 },
    { channel: protocolChannel, type: "heartbeat" },
    { channel: protocolChannel, type: "heartbeat", surfaceId: longIdentifier },
    {
      channel: protocolChannel,
      surfaceId: "surface-1",
      callId: 1,
      action: "dice.roll",
      input: {},
    },
    {
      channel: protocolChannel,
      surfaceId: "surface-1",
      callId: "call-1",
      action: "invalid",
      input: {},
    },
    {
      channel: protocolChannel,
      type: "guest_error",
      surfaceId: "surface-1",
      message: 42,
    },
    {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/unknown",
      params: {},
    },
    {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/message",
      params: { role: "assistant", content: { type: "text", text: "bad role" } },
    },
    {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/open-link",
      params: { url: 42 },
    },
    {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/update-model-context",
      params: { structuredContent: [] },
    },
    {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/open-link",
      params: { url: "https://example.com" },
      unexpected: true,
    },
    {
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: longIdentifier,
      ok: false,
    },
    {
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-1",
      ok: false,
      value: { unexpected: true },
    },
    {
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-1",
      ok: true,
      value: null,
      unexpected: true,
    },
  ]) {
    assert.deepEqual(parseSandboxMessage(message), { ok: false, reason: "bad_message" })
  }

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "capability_call",
      surfaceId: "surface-1",
      callId: "capability-1",
      capability: "ui/update-model-context",
      params: { structuredContent: cyclic },
    }),
    { ok: false, reason: "bad_message" },
  )
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "teardown",
      surfaceId: "surface-1",
      requestId: "teardown-cyclic",
      ok: true,
      value: cyclic,
    }),
    { ok: false, reason: "bad_message" },
  )
})
