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
  ]) {
    assert.deepEqual(parseSandboxMessage(message), { ok: false, reason: "bad_message" })
  }
})
