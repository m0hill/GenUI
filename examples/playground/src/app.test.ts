import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import {
  codeDialect,
  parseActionResult,
  parseSurface,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "@genui/protocol"
import { app } from "./app.js"
import { resetDemoOrders } from "./actions.js"

const postJson = async (path: string, value: unknown): Promise<Response> =>
  await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })

const createSurface = async (content = `<p>Orders</p>`): Promise<Surface> => {
  const response = await postJson("/genui/surface", { content })
  assert.equal(response.status, 200)
  const surface = parseSurface(await response.json())
  if (surface === undefined) throw new Error("Expected a surface response.")
  return surface
}

const execute = async (call: ActionCall, approved = false): Promise<ActionResult> => {
  const response = await postJson("/genui/execute", { call, approved })
  const result = parseActionResult(await response.json())
  if (result === undefined) throw new Error("Expected an action result response.")
  return result
}

beforeEach(() => {
  resetDemoOrders()
})

void test("playground creates verbatim code surfaces with projected demo grants", async () => {
  const content = `<button>Orders</button><script type="module">window.ready = true</script>`
  const surface = await createSurface(content)

  assert.equal(surface.dialect, codeDialect)
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

void test("playground executes reads and forwards write approval to the kernel", async () => {
  const surface = await createSurface()
  const updateCall = {
    surfaceId: surface.id,
    callId: "update-1",
    action: "orders.update_status",
    input: { id: "ord-1001", status: "shipped" },
  } satisfies ActionCall

  assert.deepEqual(await execute(updateCall), {
    ok: false,
    error: { code: "approval_denied", message: "Action was denied." },
  })
  assert.deepEqual(await execute({ ...updateCall, callId: "update-2" }, true), {
    ok: true,
    value: { id: "ord-1001", customer: "Aster Labs", status: "shipped", total: 148 },
  })

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
  const result = parseActionResult(await response.json())

  assert.equal(response.status, 400)
  assert.deepEqual(result, {
    ok: false,
    error: { code: "invalid_input", message: "Malformed action call." },
  })
})
