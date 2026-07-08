import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import { parseSandboxMessage, parseSnapshotSandboxMessage } from "./sandbox-message-schema.js"

void test("sandbox message schema parses protocol variants", () => {
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: "call-1",
      action: "dice.roll",
      input: { sides: 6 },
      target: "rollResult",
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "capability",
        surfaceId: "surface-1",
        callId: "call-1",
        action: "dice.roll",
        input: { sides: 6 },
        target: "rollResult",
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
      type: "link",
      surfaceId: "surface-1",
      href: "https://example.com/",
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "link",
        surfaceId: "surface-1",
        href: "https://example.com/",
      },
    },
  )
})

void test("sandbox message schema parses snapshot responses", () => {
  assert.deepEqual(
    parseSnapshotSandboxMessage({
      channel: protocolChannel,
      type: "snapshot",
      surfaceId: "surface-1",
      requestId: "snapshot-1",
      snapshot: {
        state: { query: "draft" },
        rowStates: { list: { "row-1": { note: "draft" } } },
      },
    }),
    {
      channel: protocolChannel,
      type: "snapshot",
      surfaceId: "surface-1",
      requestId: "snapshot-1",
      snapshot: {
        state: { query: "draft" },
        rowStates: { list: { "row-1": { note: "draft" } } },
      },
    },
  )

  assert.equal(
    parseSnapshotSandboxMessage({
      channel: protocolChannel,
      type: "snapshot",
      surfaceId: "surface-1",
      snapshot: {},
    }),
    undefined,
  )
})

void test("sandbox message schema classifies malformed boundary data", () => {
  assert.deepEqual(parseSandboxMessage("bad"), { ok: false, reason: "bad_message" })
  assert.deepEqual(parseSandboxMessage({ channel: "wrong" }), {
    ok: false,
    reason: "unknown_channel",
  })

  for (const message of [
    { channel: protocolChannel, type: "resize", surfaceId: "surface-1", height: Number.NaN },
    { channel: protocolChannel, type: "link", surfaceId: "surface-1", href: 42 },
    {
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: 1,
      action: "dice.roll",
      input: {},
    },
    {
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: "call-1",
      action: "dice.roll",
      input: {},
      target: 42,
    },
  ]) {
    assert.deepEqual(parseSandboxMessage(message), { ok: false, reason: "bad_message" })
  }
})
