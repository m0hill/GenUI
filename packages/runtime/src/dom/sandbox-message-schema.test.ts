import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import { parseSandboxMessage, parseSnapshotSandboxMessage } from "./sandbox-message-schema.js"

void test("sandbox message schema parses protocol variants", () => {
  const longDetail = "x".repeat(300)
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

  const violation = parseSandboxMessage({
    channel: protocolChannel,
    type: "violation",
    surfaceId: "surface-1",
    reason: "runtime_expression",
    detail: longDetail,
  })
  assert.deepEqual(violation, {
    ok: true,
    value: {
      channel: protocolChannel,
      type: "violation",
      surfaceId: "surface-1",
      reason: "runtime_expression",
      detail: `${"x".repeat(237)}...`,
    },
  })
  assert.deepEqual(
    parseSandboxMessage({
      channel: protocolChannel,
      type: "violation",
      surfaceId: "surface-1",
      reason: "runtime_expression",
      detail: "data-genui-text: formatCurrency($amount, $currency)",
    }),
    {
      ok: true,
      value: {
        channel: protocolChannel,
        type: "violation",
        surfaceId: "surface-1",
        reason: "runtime_expression",
        detail: "data-genui-text: formatCurrency($amount, $currency)",
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

  const longIdentifier = "x".repeat(257)
  const longHref = `https://example.com/${"x".repeat(2_100)}`
  for (const message of [
    { channel: protocolChannel, type: "resize", surfaceId: "surface-1", height: Number.NaN },
    { channel: protocolChannel, type: "resize", surfaceId: longIdentifier, height: 100 },
    { channel: protocolChannel, type: "link", surfaceId: "surface-1", href: 42 },
    { channel: protocolChannel, type: "link", surfaceId: "surface-1", href: longHref },
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
    {
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: longIdentifier,
      action: "dice.roll",
      input: {},
    },
    {
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: "call-1",
      action: longIdentifier,
      input: {},
    },
    {
      channel: protocolChannel,
      type: "capability",
      surfaceId: "surface-1",
      callId: "call-1",
      action: "dice.roll",
      input: {},
      target: longIdentifier,
    },
    {
      channel: protocolChannel,
      type: "violation",
      surfaceId: "surface-1",
      reason: "other",
    },
  ]) {
    assert.deepEqual(parseSandboxMessage(message), { ok: false, reason: "bad_message" })
  }
})
