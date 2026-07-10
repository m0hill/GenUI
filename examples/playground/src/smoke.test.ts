import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { serve, type ServerType } from "@hono/node-server"
import { chromium, type Browser } from "playwright"
import { app } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import { ordersDashboardFixture } from "./fixtures.js"
import { parseApprovalRequest, parseExecuteRequest } from "./playground-codecs.js"

let browser: Browser | undefined
let origin = ""
let server: ServerType | undefined

type ApprovalRoundTripRequest =
  | {
      readonly path: "/genui/execute"
      readonly body: NonNullable<ReturnType<typeof parseExecuteRequest>>
    }
  | {
      readonly path: "/genui/approve"
      readonly body: NonNullable<ReturnType<typeof parseApprovalRequest>>
    }

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

  const approvalRoundTrip: ApprovalRoundTripRequest[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname
    const value: unknown = JSON.parse(request.postData() ?? "null")
    if (path === "/genui/execute") {
      const body = parseExecuteRequest(value)
      if (body?.action === "orders.update_status") {
        approvalRoundTrip.push({ path, body })
      }
    } else if (path === "/genui/approve") {
      const body = parseApprovalRequest(value)
      if (body !== undefined) approvalRoundTrip.push({ path, body })
    }
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

  assert.deepEqual(
    approvalRoundTrip.map((request) => request.path),
    ["/genui/execute", "/genui/approve", "/genui/execute"],
  )
  const firstExecute = approvalRoundTrip[0]
  const approve = approvalRoundTrip[1]
  const secondExecute = approvalRoundTrip[2]
  assert.ok(firstExecute?.path === "/genui/execute")
  assert.ok(approve?.path === "/genui/approve")
  assert.ok(secondExecute?.path === "/genui/execute")
  assert.equal(firstExecute.body.callId, secondExecute.body.callId)
  assert.equal(approve.body.surfaceId, firstExecute.body.surfaceId)
  assert.equal(approve.body.callId, firstExecute.body.callId)

  const eventLog = page.locator("#event-log")
  const eventText = await eventLog.textContent()
  assert.equal(eventText?.includes('"type": "audit"'), true)
  assert.equal(eventText?.includes('"outcome": "approval_required"'), true)
  assert.equal(eventText?.includes('"outcome": "ok"'), true)

  await page.locator("#fixture-error").click()
  await frame.locator("#throw-error").click()
  await page.locator("#event-log").getByText("Fixture guest failure", { exact: false }).waitFor()
})
