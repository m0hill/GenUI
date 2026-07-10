import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import {
  codeDialect,
  parseSubscriptionDelivery,
  parseSurface,
  type ActionCall,
  type ActionResult,
  type SubscriptionRequest,
  type Surface,
} from "genui/protocol"
import { app, resetPlaygroundState } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import {
  parseApprovalResponse,
  parseExecuteEnvelope,
  parseRecord,
  parseSubscriptionOpenFailure,
} from "./playground-codecs.js"

const sessionCookie = (subject: string): string => `genui_session=${subject}`
const defaultCookie = sessionCookie("session-test")

const postJson = async (path: string, value: unknown, cookie = defaultCookie): Promise<Response> =>
  await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(value),
  })

const createSurface = async (content = `<p>Orders</p>`): Promise<Surface> => {
  const response = await postJson("/genui/surface", { content })
  assert.equal(response.status, 200)
  const surface = parseSurface(await response.json())
  if (surface === undefined) throw new Error("Expected a surface response.")
  return surface
}

const execute = async (
  call: ActionCall,
  cookie = defaultCookie,
  approvalRetryToken?: string,
): Promise<ActionResult> => {
  const response = await postJson(
    "/genui/execute",
    { call, ...(approvalRetryToken === undefined ? {} : { approvalRetryToken }) },
    cookie,
  )
  const envelope = parseExecuteEnvelope(await response.json())
  if (envelope === undefined) throw new Error("Expected an execute response envelope.")
  return envelope.result
}

const readFirstSubscriptionDelivery = async (response: Response) => {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error("Expected a subscription response body.")
  const decoder = new TextDecoder()
  let encoded = ""
  while (!encoded.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) break
    encoded += decoder.decode(chunk.value, { stream: true })
  }
  const delivery = parseSubscriptionDelivery(JSON.parse(encoded.split("\n")[0] ?? "null"))
  await reader.cancel()
  return delivery
}

beforeEach(() => {
  resetDemoOrders()
  resetPlaygroundState()
})

void test("playground creates verbatim code surfaces with projected demo grants", async () => {
  const content = `<button>Orders</button><script type="module">window.ready = true</script>`
  const surface = await createSurface(content)

  assert.equal(surface.dialect, codeDialect)
  assert.equal(surface.grant.subject, "session-test")
  assert.equal(surface.content, content)
  assert.deepEqual(
    surface.grant.actions.map((action) => action.name),
    ["orders.search", "orders.get", "orders.update_status"],
  )
  assert.deepEqual(
    surface.grant.subscriptions.map((subscription) => subscription.name),
    ["orders.changes"],
  )
})

void test("playground instructions expose granted schemas but not confidential actions", async () => {
  const response = await app.request("/genui/instructions")
  const instructions = await response.text()

  assert.equal(response.status, 200)
  assert.equal(instructions.includes("orders.search"), true)
  assert.equal(instructions.includes('"query"'), true)
  assert.equal(instructions.includes("orders.export_private"), false)
  assert.equal(instructions.includes("genui.capabilities"), true)
  assert.equal(instructions.includes("genui.sendMessage"), true)
  assert.equal(instructions.includes("genui.openLink"), true)
  assert.equal(instructions.includes("genui.updateModelContext"), true)
  assert.equal(instructions.includes("genui.teardown"), true)
  assert.equal(instructions.includes("genui.hostContext"), true)
  assert.equal(instructions.includes("genui.onHostContextChange"), true)
  assert.equal(instructions.includes("genui.subscriptions"), true)
  assert.equal(instructions.includes("genui.subscribe"), true)
  assert.equal(instructions.includes("orders.changes"), true)
})

void test("playground streams validated subscription deliveries with app-specific framing", async () => {
  const surface = await createSurface()
  const request = {
    surfaceId: surface.id,
    subscriptionId: "subscription-test",
    subscription: "orders.changes",
    input: { status: "processing" },
  } satisfies SubscriptionRequest
  const response = await postJson("/genui/subscribe", request)

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/)
  const delivery = await readFirstSubscriptionDelivery(response)
  assert.deepEqual(delivery, {
    type: "event",
    surfaceId: surface.id,
    subscriptionId: "subscription-test",
    sequence: 1,
    event: {
      type: "orders.snapshot",
      orders: [
        {
          id: "ord-1001",
          customer: "Aster Labs",
          status: "processing",
          total: 148,
        },
      ],
    },
  })

  // Repeated response cancellation must release the kernel's four-stream active cap.
  for (let index = 0; index < 5; index += 1) {
    const reopened = await postJson("/genui/subscribe", {
      ...request,
      subscriptionId: `subscription-reopened-${index}`,
    })
    assert.equal(reopened.status, 200)
    assert.equal((await readFirstSubscriptionDelivery(reopened))?.type, "event")
  }

  const denied = await postJson(
    "/genui/subscribe",
    { ...request, subscriptionId: "subscription-wrong-subject" },
    sessionCookie("session-other"),
  )
  assert.equal(denied.status, 400)
  assert.equal(parseSubscriptionOpenFailure(await denied.json())?.error.code, "not_granted")

  const malformed = await postJson("/genui/subscribe", { subscription: "orders.changes" })
  assert.equal(malformed.status, 400)
  assert.equal(parseSubscriptionOpenFailure(await malformed.json())?.error.code, "invalid_input")
})

void test("playground action schemas canonicalize input and reject unknown keys", async () => {
  const surface = await createSurface()

  const trimmedSearch = await execute({
    surfaceId: surface.id,
    callId: "search-trimmed",
    action: "orders.search",
    input: { query: "  aster  " },
  })
  assert.deepEqual(trimmedSearch, {
    ok: true,
    value: {
      orders: [{ id: "ord-1001", customer: "Aster Labs", status: "processing", total: 148 }],
    },
  })

  const defaultSearch = await execute({
    surfaceId: surface.id,
    callId: "search-default",
    action: "orders.search",
    input: {},
  })
  assert.equal(defaultSearch.ok, true)
  if (defaultSearch.ok) {
    const value = parseRecord(defaultSearch.value)
    assert.equal(Array.isArray(value?.orders) ? value.orders.length : undefined, 3)
  }

  const unknownKey = await execute({
    surfaceId: surface.id,
    callId: "search-unknown-key",
    action: "orders.search",
    input: { query: "", unexpected: true },
  })
  assert.equal(unknownKey.ok, false)
  if (!unknownKey.ok) assert.equal(unknownKey.error.code, "invalid_input")
})

void test("playground requires one server-held approval before executing a write", async () => {
  const surface = await createSurface()
  const updateCall = {
    surfaceId: surface.id,
    callId: "update-1",
    action: "orders.update_status",
    input: { id: "ord-1001", status: "shipped" },
  } satisfies ActionCall

  assert.equal(
    (await postJson("/genui/approve", { ...updateCall, token: "not-issued" })).status,
    409,
  )

  const bypass = await postJson("/genui/execute", { call: updateCall, approved: true })
  const pending = parseExecuteEnvelope(await bypass.json())
  assert.deepEqual(pending?.result, {
    ok: false,
    error: {
      code: "approval_required",
      message: "Change order ord-1001 to shipped",
    },
  })
  assert.deepEqual(
    pending?.audit.map((entry) => entry.outcome),
    ["approval_required"],
  )
  const approvalToken = pending?.approvalToken
  assert.equal(typeof approvalToken, "string")
  const approvalRequest = { ...updateCall, token: approvalToken ?? "" }
  assert.equal(
    (await postJson("/genui/approve", approvalRequest, sessionCookie("session-other"))).status,
    403,
  )
  const approvalResponse = await postJson("/genui/approve", approvalRequest)
  assert.equal(approvalResponse.status, 200)
  const retryToken = parseApprovalResponse(await approvalResponse.json())?.retryToken
  assert.equal(typeof retryToken, "string")
  assert.equal((await postJson("/genui/approve", approvalRequest)).status, 409)

  const approved = await execute(updateCall, defaultCookie, retryToken)
  assert.deepEqual(approved, {
    ok: true,
    value: { id: "ord-1001", customer: "Aster Labs", status: "shipped", total: 148 },
  })
  assert.deepEqual(await execute(updateCall), approved)

  const getResult = await execute({
    surfaceId: surface.id,
    callId: "get-1",
    action: "orders.get",
    input: { id: "ord-1001" },
  })
  assert.deepEqual(getResult, {
    ok: true,
    value: { id: "ord-1001", customer: "Aster Labs", status: "shipped", total: 148 },
  })
})

void test("playground rejects malformed execute envelopes with a codec error", async () => {
  const response = await postJson("/genui/execute", { call: { action: "orders.search" } })
  const result = parseExecuteEnvelope(await response.json())?.result

  assert.equal(response.status, 400)
  assert.deepEqual(result, {
    ok: false,
    error: { code: "invalid_input", message: "Malformed action call." },
  })
})
