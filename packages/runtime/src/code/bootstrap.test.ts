import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createSandboxWindow,
  flushAsync,
  isRecord,
  jsonRoundTrip,
} from "../dom/test-support.test-support.js"
import type { Action } from "../types.js"
import { codeBootstrapScript } from "./bootstrap.js"

const channel = "genui/dom/0"
const surfaceId = "surface-code"

interface GuestApi {
  readonly surfaceId: string
  readonly actions: readonly unknown[]
  call(name: string, input: unknown): Promise<unknown>
  snapshot(provider: (restored?: unknown) => unknown): void
}

interface HarnessOptions {
  readonly actions?: readonly Action[]
  readonly restore?: unknown
}

const createHarness = (
  options: HarnessOptions = {},
): ReturnType<typeof createSandboxWindow> & { readonly genui: GuestApi } => {
  const harness = createSandboxWindow("")
  harness.window.eval(
    codeBootstrapScript({
      channel,
      surfaceId,
      actions: options.actions ?? [],
      ...(options.restore === undefined ? {} : { restore: options.restore }),
    }),
  )
  const genui = Reflect.get(harness.window, "genui")
  if (!isRecord(genui) || typeof genui.call !== "function") {
    throw new Error("Expected the code guest API.")
  }

  return { ...harness, genui: genui as unknown as GuestApi }
}

void test("code bootstrap installs the pinned API with its embedded grant", () => {
  const actions = [
    {
      name: "orders.search",
      description: "Search orders.",
      effect: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
      },
    },
  ] satisfies readonly Action[]
  const { genui } = createHarness({ actions })

  assert.equal(genui.surfaceId, surfaceId)
  assert.deepEqual(jsonRoundTrip(genui.actions), actions)
})

void test("red team: unknown, replayed, and duplicate results are ignored", async () => {
  const { genui, messages, window } = createHarness()
  let settled = false
  const result = genui.call("orders.search", { status: "open" }).then((value) => {
    settled = true
    return value
  })
  const call = messages.find((message) => isRecord(message) && typeof message.callId === "string")
  assert.ok(isRecord(call))
  assert.deepEqual(jsonRoundTrip(call), {
    channel,
    surfaceId,
    callId: call.callId,
    action: "orders.search",
    input: { status: "open" },
  })

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel,
        type: "result",
        surfaceId,
        callId: "unknown-call",
        result: { ok: true, value: "wrong" },
      },
    }),
  )
  await Promise.resolve()
  assert.equal(settled, false)

  const response = {
    channel,
    type: "result",
    surfaceId,
    callId: call.callId,
    result: { ok: true, value: [{ id: "order-1" }] },
  }
  window.dispatchEvent(new window.MessageEvent("message", { data: response }))
  assert.deepEqual(jsonRoundTrip(await result), [{ id: "order-1" }])

  let secondSettled = false
  const secondResult = genui.call("orders.search", { status: "shipped" }).then((value) => {
    secondSettled = true
    return value
  })
  const calls = messages.filter(
    (message) => isRecord(message) && typeof message.callId === "string",
  )
  const secondCall = calls[1]
  assert.ok(isRecord(secondCall))

  window.dispatchEvent(new window.MessageEvent("message", { data: response }))
  await Promise.resolve()
  assert.equal(secondSettled, false)

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel,
        type: "result",
        surfaceId,
        callId: secondCall.callId,
        result: { ok: true, value: [{ id: "order-2" }] },
      },
    }),
  )
  assert.deepEqual(jsonRoundTrip(await secondResult), [{ id: "order-2" }])
})

void test("code bootstrap rejects failed calls with GenuiActionError", async () => {
  const { genui, messages, window } = createHarness()
  const result = genui.call("orders.update_status", { id: "order-1", status: "shipped" })
  const call = messages.find((message) => isRecord(message) && typeof message.callId === "string")
  assert.ok(isRecord(call))

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel,
        type: "result",
        surfaceId,
        callId: call.callId,
        result: {
          ok: false,
          error: { code: "approval_denied", message: "Action was denied." },
        },
      },
    }),
  )

  await assert.rejects(result, (error: unknown) => {
    assert.ok(isRecord(error))
    assert.equal(error.name, "GenuiActionError")
    assert.equal(error.code, "approval_denied")
    assert.equal(error.message, "Action was denied.")
    return true
  })
})

void test("code bootstrap reports guest errors and unhandled rejections", () => {
  const { messages, window } = createHarness()
  const onerror = Reflect.get(window, "onerror")
  if (typeof onerror !== "function") throw new Error("Expected a window.onerror handler.")
  Reflect.apply(onerror, window, ["Synchronous boom", "", 0, 0, { stack: "sync stack" }])

  const rejection = new window.Event("unhandledrejection")
  Object.defineProperty(rejection, "reason", {
    value: { message: "Asynchronous boom", stack: "async stack" },
  })
  window.dispatchEvent(rejection)

  assert.deepEqual(
    messages
      .filter((message) => isRecord(message) && message.type === "guest_error")
      .map(jsonRoundTrip),
    [
      {
        channel,
        surfaceId,
        type: "guest_error",
        message: "Synchronous boom",
        stack: "sync stack",
      },
      {
        channel,
        surfaceId,
        type: "guest_error",
        message: "Asynchronous boom",
        stack: "async stack",
      },
    ],
  )
})

void test("code bootstrap restores and captures registered guest state", async () => {
  const { genui, messages, window } = createHarness({ restore: { count: 2 } })
  let state = { count: 0 }
  genui.snapshot((restored) => {
    if (isRecord(restored) && typeof restored.count === "number") {
      state = { count: restored.count }
    }
    return state
  })
  assert.deepEqual(state, { count: 2 })

  state = { count: 3 }
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { channel, type: "snapshot_request", surfaceId, requestId: "snapshot-1" },
    }),
  )
  await flushAsync()

  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "snapshot")),
    {
      channel,
      surfaceId,
      type: "snapshot",
      requestId: "snapshot-1",
      ok: true,
      value: { count: 3 },
    },
  )
})

void test("code bootstrap reports snapshot provider failures", async () => {
  const { genui, messages, window } = createHarness()
  genui.snapshot(() => {
    throw new Error("Snapshot failed")
  })
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { channel, type: "snapshot_request", surfaceId, requestId: "snapshot-failed" },
    }),
  )
  await flushAsync()

  const guestError = messages.find((message) => isRecord(message) && message.type === "guest_error")
  assert.ok(isRecord(guestError))
  assert.equal(guestError.message, "Snapshot failed")
  assert.equal(typeof guestError.stack, "string")
  assert.deepEqual(
    jsonRoundTrip(messages.find((message) => isRecord(message) && message.type === "snapshot")),
    {
      channel,
      surfaceId,
      type: "snapshot",
      requestId: "snapshot-failed",
      ok: false,
    },
  )
})
