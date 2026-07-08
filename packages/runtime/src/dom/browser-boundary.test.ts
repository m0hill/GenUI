import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { chromium, type Browser, type Frame, type Page } from "playwright"
import { sandboxBridgeScript } from "./sandbox-bridge.js"

let browser: Browser | undefined

const surfaceId = "surface-browser"

const sandboxDocument = (html: string): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>${html}<script>${sandboxBridgeScript(surfaceId)}</script></body>
</html>`

interface HostEvent {
  readonly type: string
  readonly reason?: string
  readonly href?: string
  readonly height?: number
  readonly target?: string
}

interface CapabilityPost {
  readonly callId: string
  readonly action: string
  readonly input: unknown
  readonly target?: string
}

const newBrowserPage = async (): Promise<Page> => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  return browser.newPage()
}

const installHostHarness = async (
  page: Page,
  html: string,
  options: { readonly maxHeight?: number } = {},
): Promise<Frame> => {
  await page.setContent(`<main id="root"></main>`)
  await page.evaluate(
    ({ srcdoc, maxHeight }) => {
      const events: HostEvent[] = []
      const calls: CapabilityPost[] = []
      let lastCall: CapabilityPost | undefined

      const root = document.querySelector("#root")
      if (root === null) throw new Error("Missing root")

      const iframe = document.createElement("iframe")
      iframe.setAttribute("sandbox", "allow-scripts allow-forms")
      iframe.setAttribute("referrerpolicy", "no-referrer")
      iframe.style.border = "0"
      iframe.style.display = "block"
      iframe.style.width = "100%"
      iframe.srcdoc = srcdoc
      root.replaceChildren(iframe)

      const completeLastCall = (result: unknown): void => {
        if (lastCall === undefined) throw new Error("No capability call is pending.")
        const state =
          typeof result === "object" &&
          result !== null &&
          "ok" in result &&
          result.ok === true &&
          "value" in result
            ? { status: "complete", value: result.value }
            : { status: "error", error: "Capability failed." }

        iframe.contentWindow?.postMessage(
          {
            channel: "genui/dom/0",
            type: "result",
            surfaceId: "surface-browser",
            callId: lastCall.callId,
            action: lastCall.action,
            target: lastCall.target ?? "diceRoll",
            result,
            state,
          },
          "*",
        )
      }

      window.addEventListener("message", (event) => {
        if (event.source !== iframe.contentWindow) return

        const message = event.data
        if (typeof message !== "object" || message === null) {
          events.push({ type: "violation", reason: "bad_message" })
          return
        }

        if (message.channel !== "genui/dom/0") {
          events.push({ type: "violation", reason: "unknown_channel" })
          return
        }

        if (message.type === "resize" && typeof message.height === "number") {
          const height = Math.max(0, Math.min(Math.ceil(message.height), maxHeight ?? 1_200))
          iframe.style.height = `${height}px`
          events.push({ type: "resize", height })
          return
        }

        if (message.type === "link" && typeof message.href === "string") {
          const url = new URL(message.href)
          if (url.protocol !== "https:") {
            events.push({ type: "violation", reason: "unsafe_link" })
            return
          }
          events.push({ type: "link", href: url.href })
          return
        }

        if (
          message.type === "capability" &&
          typeof message.callId === "string" &&
          typeof message.action === "string"
        ) {
          lastCall = {
            callId: message.callId,
            action: message.action,
            input: message.input,
            ...(typeof message.target === "string" ? { target: message.target } : {}),
          }
          calls.push(lastCall)
          events.push({ type: "call", target: lastCall.target })
        }
      })

      Object.assign(window, { __genuiHost: { calls, completeLastCall, events } })
    },
    { srcdoc: sandboxDocument(html), maxHeight: options.maxHeight },
  )

  const iframe = await page.locator("iframe").elementHandle()
  if (iframe === null) throw new Error("Sandbox iframe was not mounted.")
  const frame = await iframe.contentFrame()
  if (frame === null) throw new Error("Sandbox iframe has no frame.")
  await frame.waitForLoadState("domcontentloaded")
  return frame
}

const hostCalls = async (page: Page): Promise<readonly CapabilityPost[]> =>
  page.evaluate(() => window.__genuiHost.calls)

const hostEvents = async (page: Page): Promise<readonly HostEvent[]> =>
  page.evaluate(() => window.__genuiHost.events)

const completeLastCall = async (page: Page, result: unknown): Promise<void> => {
  await page.evaluate((value) => window.__genuiHost.completeLastCall(value), result)
}

const waitForHostEvent = async (page: Page, type: string, reason?: string): Promise<void> => {
  await page.waitForFunction(
    ({ eventType, eventReason }) =>
      window.__genuiHost.events.some(
        (event) =>
          event.type === eventType && (eventReason === undefined || event.reason === eventReason),
      ),
    { eventReason: reason, eventType: type },
  )
}

const expectVisible = async (frame: Frame, selector: string): Promise<void> => {
  await frame.locator(selector).waitFor({ state: "visible" })
}

declare global {
  interface Window {
    readonly __genuiHost: {
      readonly calls: CapabilityPost[]
      readonly events: HostEvent[]
      completeLastCall(result: unknown): void
    }
  }
}

before(async () => {
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
})

void test("browser sandbox renders capability pending and result state", async (context) => {
  const page = await newBrowserPage()
  context.after(async () => {
    await page.close()
  })

  const frame = await installHostHarness(
    page,
    `
      <form data-genui-on-submit="@capability('dice.roll', { sides: $sides }, { target: 'rollResult' })">
        <input data-genui-bind="sides" type="number" value="6">
        <button>Roll</button>
      </form>
      <p id="pending" data-genui-show="$rollResult.status == 'pending'">Loading</p>
      <p id="total" data-genui-show="$rollResult.status == 'complete'" data-genui-text="$rollResult.value.total"></p>
      ${"<p>content</p>".repeat(30)}
    `,
    { maxHeight: 80 },
  )

  await frame.locator("input").fill("8")
  await frame.locator("button").click()

  await expectVisible(frame, "#pending")
  await page.waitForFunction(() => window.__genuiHost.calls.length === 1)
  const calls = await hostCalls(page)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.action, "dice.roll")
  assert.deepEqual(calls[0]?.input, { sides: 8 })
  assert.equal(calls[0]?.target, "rollResult")

  await completeLastCall(page, { ok: true, value: { total: 8 } })
  await expectVisible(frame, "#total")
  assert.equal(await frame.locator("#total").textContent(), "8")
  await page.waitForFunction(() => document.querySelector("iframe")?.style.height === "80px")
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.style.height), "80px")
})

void test("browser sandbox prevents parent DOM access and network fetch", async (context) => {
  const page = await newBrowserPage()
  context.after(async () => {
    await page.close()
  })
  const frame = await installHostHarness(page, `<p>Boundary</p>`)
  await page.evaluate(() => {
    document.body.setAttribute("data-secret", "parent-secret")
  })

  const result = await frame.evaluate(async () => {
    const parentAccess = (() => {
      try {
        return parent.document.querySelector("[data-secret]")?.getAttribute("data-secret") ?? null
      } catch {
        return "blocked"
      }
    })()

    const fetchAccess = await fetch("https://example.com/").then(
      () => "allowed",
      () => "blocked",
    )

    return { fetchAccess, parentAccess }
  })

  assert.deepEqual(result, { fetchAccess: "blocked", parentAccess: "blocked" })
})

void test("browser sandbox renders repeated result items with scoped calls", async (context) => {
  const page = await newBrowserPage()
  context.after(async () => {
    await page.close()
  })

  const frame = await installHostHarness(
    page,
    `
      <button id="search" data-genui-on-click="@capability('orders.search', {}, { target: 'orders' })">
        Search
      </button>
      <p id="updating" data-genui-show="$orders.status == 'pending'">Updating</p>
      <table>
        <tbody data-genui-each="$orders.value.items" data-genui-as="order">
          <tr>
            <td class="order-id" data-genui-text="$order.id"></td>
            <td class="order-status" data-genui-text="$order.status"></td>
            <td>
              <button class="refund" data-genui-on-click="@capability('orders.refund', { id: $order.id }, { target: 'orders' })">
                Refund
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  )

  await frame.locator("#search").click()
  await page.waitForFunction(() => window.__genuiHost.calls.length === 1)
  await completeLastCall(page, {
    ok: true,
    value: {
      items: [
        { id: "order-1", status: "paid" },
        { id: "order-2", status: "pending" },
      ],
    },
  })

  await frame.locator("tbody tr").first().waitFor()
  assert.equal(await frame.locator("tbody tr").count(), 2)
  assert.equal(await frame.locator(".order-id").nth(1).textContent(), "order-2")
  assert.equal(await frame.locator(".order-status").nth(1).textContent(), "pending")

  await frame.locator(".refund").nth(1).click()
  await expectVisible(frame, "#updating")
  await page.waitForFunction(() => window.__genuiHost.calls.length === 2)
  assert.equal(await frame.locator("tbody tr").count(), 2)
  const calls = await hostCalls(page)
  assert.equal(calls[1]?.action, "orders.refund")
  assert.deepEqual(calls[1]?.input, { id: "order-2" })
  assert.equal(calls[1]?.target, "orders")
})

void test("browser sandbox renders nested repeated items with merged scoped calls", async (context) => {
  const page = await newBrowserPage()
  context.after(async () => {
    await page.close()
  })

  const frame = await installHostHarness(
    page,
    `
      <button id="search" data-genui-on-click="@capability('orders.search', {}, { target: 'orders' })">
        Search
      </button>
      <section data-genui-each="$orders.value.items" data-genui-as="order">
        <article>
          <h2 data-genui-text="$order.id"></h2>
          <ul data-genui-each="$order.lines" data-genui-as="line">
            <li>
              <span class="line-id" data-genui-text="$line.id"></span>
              <button class="adjust" data-genui-on-click="@capability('orders.adjust_line', { orderId: $order.id, lineId: $line.id }, { target: 'orders' })">
                Adjust
              </button>
            </li>
          </ul>
        </article>
      </section>
    `,
  )

  await frame.locator("#search").click()
  await page.waitForFunction(() => window.__genuiHost.calls.length === 1)
  await completeLastCall(page, {
    ok: true,
    value: {
      items: [
        { id: "order-1", lines: [{ id: "line-1" }, { id: "line-2" }] },
        { id: "order-2", lines: [{ id: "line-3" }] },
      ],
    },
  })

  await frame.locator("li").first().waitFor()
  assert.equal(await frame.locator("article").count(), 2)
  assert.equal(await frame.locator("li").count(), 3)
  assert.equal(await frame.locator(".line-id").nth(2).textContent(), "line-3")

  await frame.locator(".adjust").nth(2).click()
  await page.waitForFunction(() => window.__genuiHost.calls.length === 2)
  const calls = await hostCalls(page)
  assert.equal(calls[1]?.action, "orders.adjust_line")
  assert.deepEqual(calls[1]?.input, { lineId: "line-3", orderId: "order-2" })
  assert.equal(calls[1]?.target, "orders")
})

void test("browser sandbox brokers links and refuses unsafe forged links", async (context) => {
  const page = await newBrowserPage()
  context.after(async () => {
    await page.close()
  })
  const frame = await installHostHarness(
    page,
    `<a id="safe" href="https://example.com/path">Open</a>`,
  )

  await frame.locator("#safe").click()
  await waitForHostEvent(page, "link")
  await frame.evaluate(() => {
    parent.postMessage(
      {
        channel: "genui/dom/0",
        type: "link",
        surfaceId: "surface-browser",
        href: "javascript:alert(1)",
      },
      "*",
    )
  })
  await waitForHostEvent(page, "violation", "unsafe_link")

  const events = await hostEvents(page)
  assert.ok(
    events.some((event) => event.type === "link" && event.href === "https://example.com/path"),
  )
  assert.ok(events.some((event) => event.type === "violation" && event.reason === "unsafe_link"))
})
