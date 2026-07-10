import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { serve, type ServerType } from "@hono/node-server"
import { chromium, type Browser } from "playwright"
import { app } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import { ordersDashboardFixture } from "./fixtures.js"
import {
  parseApprovalRequest,
  parseExecuteRequest,
  parsePlaygroundEvent,
} from "./playground-codecs.js"

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

const capabilityMessage = "Summarize the selected rows."
const modelContextContent = "Rows 2 and 5 are selected."
const capabilityUrl = "https://example.com/docs"
const delayedTeardownFixture = `
  <p id="delayed-teardown">Delayed teardown fixture</p>
  <script type="module">
    genui.teardown(() => new Promise((resolve) => setTimeout(resolve, 100)))
  </script>
`
const stoppedLoadFixture = `
  <p id="stopped-load">Stopped load fixture</p>
  <script>window.stop()</script>
`
const hostContextFixture = `
  <output id="host-context"></output>
  <script type="module">
    const context = genui.hostContext
    const output = document.querySelector("#host-context")
    output.textContent = JSON.stringify({
      context,
      frozen: Object.isFrozen(context),
      dimensionsFrozen: Object.isFrozen(context.containerDimensions),
    })
    output.dataset.ready = "true"
  </script>
`
const capabilitiesFixture = `
  <p id="capabilities"></p>
  <button id="send-message" hidden>Send message</button>
  <output id="send-message-result"></output>
  <button id="update-context" hidden>Update model context</button>
  <output id="update-context-result"></output>
  <button id="open-link" hidden>Open link</button>
  <output id="open-link-result"></output>
  <script type="module">
    const capabilityNames = ["sendMessage", "openLink", "updateModelContext"]
    document.querySelector("#capabilities").textContent = capabilityNames
      .filter((name) => genui.capabilities[name])
      .join(",")

    const run = async (output, operation) => {
      try {
        await operation()
        output.textContent = "ok"
      } catch (error) {
        output.textContent = error instanceof Error ? error.message : "denied"
      }
    }

    const sendMessage = document.querySelector("#send-message")
    sendMessage.hidden = !genui.capabilities.sendMessage
    sendMessage.onclick = () => run(
      document.querySelector("#send-message-result"),
      () => genui.sendMessage(${JSON.stringify(capabilityMessage)}),
    )

    const updateContext = document.querySelector("#update-context")
    updateContext.hidden = !genui.capabilities.updateModelContext
    updateContext.onclick = () => run(
      document.querySelector("#update-context-result"),
      () => genui.updateModelContext({
        content: ${JSON.stringify(modelContextContent)},
        structuredContent: { selectedRows: [2, 5] },
      }),
    )

    const openLink = document.querySelector("#open-link")
    openLink.hidden = !genui.capabilities.openLink
    openLink.onclick = () => run(
      document.querySelector("#open-link-result"),
      () => genui.openLink(${JSON.stringify(capabilityUrl)}),
    )
  </script>
`

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
      if (body?.call.action === "orders.update_status") {
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
  assert.equal(firstExecute.body.call.callId, secondExecute.body.call.callId)
  assert.equal(firstExecute.body.approvalRetryToken, undefined)
  assert.equal(approve.body.surfaceId, firstExecute.body.call.surfaceId)
  assert.equal(approve.body.callId, firstExecute.body.call.callId)
  assert.equal(typeof secondExecute.body.approvalRetryToken, "string")
  assert.notEqual(secondExecute.body.approvalRetryToken, approve.body.token)

  const eventLog = page.locator("#event-log")
  const eventText = await eventLog.textContent()
  assert.equal(eventText?.includes('"type": "audit"'), true)
  assert.equal(eventText?.includes('"outcome": "approval_required"'), true)
  assert.equal(eventText?.includes('"outcome": "ok"'), true)

  await page.locator("#fixture-error").click()
  await eventLog.getByText('"type": "host_teardown"', { exact: false }).waitFor({ timeout: 1_000 })
  const replacementEvents = (await page.locator("#event-log > li").allTextContents()).map(
    (encoded, index) => {
      const event = parsePlaygroundEvent(JSON.parse(encoded))
      if (event === undefined) throw new Error(`Replacement event ${index + 1} is malformed.`)
      return event
    },
  )
  assert.deepEqual(
    replacementEvents.find((event) => event.type === "host_teardown"),
    {
      type: "host_teardown",
      reason: "surface_replaced",
      snapshotCaptured: false,
    },
  )
  await frame.locator("#throw-error").click()
  await page.locator("#event-log").getByText("Fixture guest failure", { exact: false }).waitFor()
})

void test("playground advertises and delivers host capabilities", async (context) => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  context.after(async () => {
    await page.close()
  })
  await page.addInitScript(() => {
    const openedUrls: { url: string; target: string; features: string }[] = []
    Reflect.set(window, "__openedUrls", openedUrls)
    window.open = (url, target, features) => {
      openedUrls.push({
        url: String(url),
        target: target ?? "",
        features: features ?? "",
      })
      // Browsers may return null for a successfully opened noopener tab.
      return null
    }
  })

  await page.goto(origin)
  await page.locator("#surface-source").fill(capabilitiesFixture)
  await page.locator("#create-surface").click()

  const frame = page.frameLocator("#surface iframe")
  const capabilities = frame.locator("#capabilities")
  await capabilities.getByText("sendMessage,openLink,updateModelContext", { exact: true }).waitFor()
  assert.equal(await frame.locator("#send-message").isVisible(), true)
  assert.equal(await frame.locator("#update-context").isVisible(), true)
  assert.equal(await frame.locator("#open-link").isVisible(), true)

  await frame.locator("#send-message").click()
  await frame.locator("#send-message-result").getByText("ok", { exact: true }).waitFor()

  await frame.locator("#update-context").click()
  await frame.locator("#update-context-result").getByText("ok", { exact: true }).waitFor()

  const linkDialog = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message())
      await dialog.accept()
    })
  })
  await frame.locator("#open-link").click()
  assert.equal(await linkDialog, `Generated surface requested this URL:\n\n${capabilityUrl}`)
  await frame.locator("#open-link-result").getByText("ok", { exact: true }).waitFor()

  const openedUrls: unknown = await page.evaluate(() => Reflect.get(window, "__openedUrls"))
  assert.deepEqual(openedUrls, [
    { url: capabilityUrl, target: "_blank", features: "noopener,noreferrer" },
  ])

  const encodedEvents = await page.locator("#event-log > li").allTextContents()
  const events = encodedEvents.map((encoded, index) => {
    const event = parsePlaygroundEvent(JSON.parse(encoded))
    if (event === undefined) throw new Error(`Event ${index + 1} is malformed.`)
    return event
  })
  assert.deepEqual(
    events.flatMap((event) => (event.type === "host_capability" ? [event] : [])),
    [
      {
        type: "host_capability",
        capability: "sendMessage",
        provenance: "generated_surface",
        role: "user",
        textLength: capabilityMessage.length,
      },
      {
        type: "host_capability",
        capability: "updateModelContext",
        provenance: "generated_surface",
        contentLength: modelContextContent.length,
        structuredContentKeys: ["selectedRows"],
      },
      {
        type: "host_capability",
        capability: "openLink",
        provenance: "generated_surface",
        url: capabilityUrl,
      },
    ],
  )
  assert.deepEqual(
    events.flatMap((event) =>
      event.type === "capability_result"
        ? [{ capability: event.capability, outcome: event.outcome }]
        : [],
    ),
    [
      { capability: "sendMessage", outcome: "ok" },
      { capability: "updateModelContext", outcome: "ok" },
      { capability: "openLink", outcome: "ok" },
    ],
  )
})

void test("playground exposes host context before guest startup", async (context) => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  context.after(async () => {
    await page.close()
  })

  await page.goto(origin)
  await page.locator("#surface-source").fill(hostContextFixture)
  await page.locator("#create-surface").click()

  const output = page.frameLocator("#surface iframe").locator('#host-context[data-ready="true"]')
  await output.waitFor()
  const encoded = await output.textContent()
  assert.deepEqual(JSON.parse(encoded ?? "null"), {
    context: {
      containerDimensions: { maxHeight: 720 },
      locale: "en-US",
      timeZone: "UTC",
      platform: "web",
    },
    frozen: true,
    dimensionsFrozen: true,
  })
})

void test("playground serializes overlapping surface replacements", async (context) => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  context.after(async () => {
    await page.close()
  })

  await page.goto(origin)
  await page.locator("#surface-source").fill(delayedTeardownFixture)
  await page.locator("#create-surface").click()
  await page.frameLocator("#surface iframe").locator("#delayed-teardown").waitFor()

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#fixture-orders")?.click()
    document.querySelector<HTMLButtonElement>("#fixture-error")?.click()
  })
  await page.frameLocator("#surface iframe").locator("#throw-error").waitFor({ timeout: 2_000 })

  const events = (await page.locator("#event-log > li").allTextContents()).map((encoded, index) => {
    const event = parsePlaygroundEvent(JSON.parse(encoded))
    if (event === undefined) throw new Error(`Concurrent event ${index + 1} is malformed.`)
    return event
  })
  assert.equal(events.filter((event) => event.type === "host_teardown").length, 1)
  assert.equal(
    events.some((event) => event.type === "violation" && event.reason === "teardown_timeout"),
    false,
  )
  assert.equal(await page.locator("#surface iframe").count(), 1)
})

void test("guest code cannot stall the playground replacement queue", async (context) => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  context.after(async () => {
    await page.close()
  })

  await page.goto(origin)
  await page.locator("#surface-source").fill(stoppedLoadFixture)
  await page.locator("#create-surface").click()
  await page.frameLocator("#surface iframe").locator("#stopped-load").waitFor()

  await page.locator("#fixture-error").click()
  await page.frameLocator("#surface iframe").locator("#throw-error").waitFor({ timeout: 2_000 })

  const events = (await page.locator("#event-log > li").allTextContents()).map((encoded, index) => {
    const event = parsePlaygroundEvent(JSON.parse(encoded))
    if (event === undefined) throw new Error(`Stopped-load event ${index + 1} is malformed.`)
    return event
  })
  assert.equal(events.filter((event) => event.type === "host_teardown").length, 1)
  assert.equal(
    events.some((event) => event.type === "violation" && event.reason === "teardown_timeout"),
    false,
  )
  assert.equal(await page.locator("#surface iframe").count(), 1)
})
