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

  await frame.locator('[data-order-id="ord-1001"] select[data-status]').selectOption("shipped")
  page.once("dialog", async (dialog) => dialog.accept())
  await frame.locator('[data-order-id="ord-1001"] button[data-update]').click()
  await frame
    .locator('[data-order-id="ord-1001"] select[data-status]')
    .waitFor({ state: "visible" })
  assert.equal(
    await frame.locator('[data-order-id="ord-1001"] select[data-status]').inputValue(),
    "shipped",
  )

  await page.locator("#fixture-error").click()
  await frame.locator("#throw-error").click()
  await page.locator("#event-log").getByText("Fixture guest failure", { exact: false }).waitFor()
})
