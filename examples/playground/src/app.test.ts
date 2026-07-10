import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import {
  codeDialect,
  parseSurface,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "genui/protocol"
import { app, resetPlaygroundState } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import { parseExecuteEnvelope } from "./playground-codecs.js"

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

const execute = async (call: ActionCall, cookie = defaultCookie): Promise<ActionResult> => {
  const response = await postJson("/genui/execute", { call }, cookie)
  const envelope = parseExecuteEnvelope(await response.json())
  if (envelope === undefined) throw new Error("Expected an execute response envelope.")
  return envelope.result
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
})

void test("playground instructions expose granted schemas but not confidential actions", async () => {
  const response = await app.request("/genui/instructions")
  const instructions = await response.text()

  assert.equal(response.status, 200)
  assert.equal(instructions.includes("orders.search"), true)
  assert.equal(instructions.includes('"query"'), true)
  assert.equal(instructions.includes("orders.export_private"), false)
})

void test("playground requires one server-held approval before executing a write", async () => {
  const surface = await createSurface()
  const updateCall = {
    surfaceId: surface.id,
    callId: "update-1",
    action: "orders.update_status",
    input: { id: "ord-1001", status: "shipped" },
  } satisfies ActionCall

  assert.equal((await postJson("/genui/approve", updateCall)).status, 409)

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
  assert.equal(
    (await postJson("/genui/approve", updateCall, sessionCookie("session-other"))).status,
    403,
  )
  assert.equal((await postJson("/genui/approve", updateCall)).status, 204)

  const approved = await execute(updateCall)
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
