import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { serve, type ServerType } from "@hono/node-server"
import { chromium, type Browser } from "playwright"
import { app } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import { ordersDashboardFixture } from "./fixtures.js"

let browser: Browser | undefined
let origin = ""
let server: ServerType | undefined

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

before(async () => {
  resetDemoOrders()
  browser = await chromium.launch()
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      origin = `http://127.0.0.1:${info.port}`
      resolve()
    })
  })
})

after(async () => {
  await browser?.close()
  await new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      resolve()
      return
    }
    server.close((error?: Error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
})

void test("playground drives paste, mount, action, approval, and guest-error flows", async (context) => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  context.after(async () => {
    await page.close()
  })

  await page.goto(origin)
  await page.locator("#surface-source").fill(ordersDashboardFixture)
  await page.locator("#create-surface").click()

  const frame = page.frameLocator("#surface iframe")
  await frame.locator('#orders-rows [data-order-id="ord-1001"]').waitFor()
  assert.equal(await frame.locator("#orders-rows tr").count(), 3)

  const approvalRequests: Array<{ readonly path: string; readonly body: unknown }> = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname
    if (path !== "/genui/execute" && path !== "/genui/approve") return
    approvalRequests.push({
      path,
      body: JSON.parse(request.postData() ?? "null") as unknown,
    })
  })
  await frame.locator('[data-order-id="ord-1001"] select[data-status]').selectOption("shipped")
  const approvalDialog = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message())
      await dialog.accept()
    })
  })
  await frame.locator('[data-order-id="ord-1001"] button[data-update]').click()
  assert.equal(await approvalDialog, "Change order ord-1001 to shipped")
  await frame
    .locator('[data-order-id="ord-1001"] select[data-status]')
    .waitFor({ state: "visible" })
  assert.equal(
    await frame.locator('[data-order-id="ord-1001"] select[data-status]').inputValue(),
    "shipped",
  )

  const approvalRoundTrip = approvalRequests.filter(
    (request) =>
      request.path === "/genui/approve" ||
      (isRecord(request.body) &&
        isRecord(request.body.call) &&
        request.body.call.action === "orders.update_status"),
  )
  assert.deepEqual(
    approvalRoundTrip.map((request) => request.path),
    ["/genui/execute", "/genui/approve", "/genui/execute"],
  )
  const firstExecute = approvalRoundTrip[0]?.body
  const approve = approvalRoundTrip[1]?.body
  const secondExecute = approvalRoundTrip[2]?.body
  assert.ok(isRecord(firstExecute) && isRecord(firstExecute.call))
  assert.ok(isRecord(approve))
  assert.ok(isRecord(secondExecute) && isRecord(secondExecute.call))
  assert.equal(firstExecute.approved, undefined)
  assert.equal(secondExecute.approved, undefined)
  assert.equal(firstExecute.call.callId, secondExecute.call.callId)
  assert.equal(approve.surfaceId, firstExecute.call.surfaceId)
  assert.equal(approve.callId, firstExecute.call.callId)

  await page.locator("#fixture-error").click()
  await frame.locator("#throw-error").click()
  await page.locator("#event-log").getByText("Fixture guest failure", { exact: false }).waitFor()
})
