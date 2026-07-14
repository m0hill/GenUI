import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { subscriptionEventByteLimit, type ActionCall, type Surface } from "../protocol/index.js"
import type { Mounted, SurfaceEvent } from "./index.js"

let browser: Browser | undefined
let domBundle = ""

type BrowserDomRuntime = Pick<typeof import("./index.js"), "mount">

interface CodeHostState {
  readonly calls: ActionCall[]
  readonly capabilityCalls?: unknown[]
  readonly subscriptionRequests?: unknown[]
  readonly events: SurfaceEvent[]
  readonly mounted: Mounted
  readonly setDocumentVisible?: (visible: boolean) => void
}

declare global {
  interface Window {
    readonly __codeHost: CodeHostState
    readonly GenuiDom: BrowserDomRuntime
  }
}

const surface: Surface = {
  id: "surface-code-browser",
  dialect: "code/0",
  content: `
    <p id="rendered">Code surface rendered</p>
    <div style="height: 200px"></div>
    <button id="granted">Roll</button>
    <output id="granted-result"></output>
    <button id="ungranted">Read secret</button>
    <output id="ungranted-result"></output>
    <button id="navigate">Navigate</button>
    <script type="module">
      document.querySelector("#granted").onclick = async () => {
        const value = await genui.call("dice.roll", { sides: 6 })
        document.querySelector("#granted-result").textContent = String(value.total)
      }
      document.querySelector("#ungranted").onclick = async () => {
        try {
          await genui.call("secrets.read", {})
        } catch (error) {
          document.querySelector("#ungranted-result").dataset.code = error.code
        }
      }
      document.querySelector("#navigate").onclick = () => {
        window.location.href = "about:blank"
      }
    </script>
  `,
  grant: {
    surfaceId: "surface-code-browser",
    actions: [
      {
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        requiresApproval: false,
        inputSchema: {
          type: "object",
          required: ["sides"],
          properties: { sides: { type: "integer" } },
        },
      },
    ],
    subscriptions: [],
  },
}

const snapshotSurface: Surface = {
  id: "surface-snapshot-browser",
  dialect: "code/0",
  content: `
    <style>
      #count { color: var(--color-text-primary, rgb(1, 2, 3)); }
    </style>
    <button id="increment">Increment</button>
    <output id="count"></output>
    <script type="module">
      let state = { count: 0 }
      const render = () => {
        document.querySelector("#count").textContent = String(state.count)
      }
      genui.snapshot((restored) => {
        if (restored && typeof restored.count === "number") state = restored
        render()
        return state
      })
      document.querySelector("#increment").onclick = () => {
        state = { count: state.count + 1 }
        render()
      }
      render()
    </script>
  `,
  grant: { surfaceId: "surface-snapshot-browser", actions: [], subscriptions: [] },
}

const guestApiSurface: Surface = {
  id: "surface-guest-api-browser",
  dialect: "code/0",
  content: `
    <output id="guest-api"></output>
    <script type="module">
      document.querySelector("#guest-api").textContent = JSON.stringify(Object.keys(genui).sort())
    </script>
  `,
  grant: {
    surfaceId: "surface-guest-api-browser",
    actions: surface.grant.actions,
    subscriptions: [
      {
        name: "orders.changes",
        description: "Receive order changes.",
        confidentiality: "normal",
        maxEventBytes: subscriptionEventByteLimit,
      },
    ],
  },
}

const hostContextSurface: Surface = {
  id: "surface-host-context-browser",
  dialect: "code/0",
  content: `
    <style>
      html, body { margin: 0; }
      #resizable-content { height: 40px; }
    </style>
    <output id="startup-context"></output>
    <output id="context-change"></output>
    <button id="grow-content">Grow</button>
    <div id="resizable-content"></div>
    <script type="module">
      const startupContext = genui.hostContext
      document.querySelector("#startup-context").textContent = JSON.stringify({
        context: startupContext,
        frozen: Object.isFrozen(startupContext),
        dimensionsFrozen: Object.isFrozen(startupContext.containerDimensions),
      })

      let state = { changes: 0, context: startupContext }
      genui.onHostContextChange((partial) => {
        state = { changes: state.changes + 1, context: genui.hostContext }
        document.querySelector("#context-change").textContent = JSON.stringify({
          partial,
          current: genui.hostContext,
          partialFrozen: Object.isFrozen(partial),
          dimensionsFrozen: Object.isFrozen(partial.containerDimensions),
        })
      })
      genui.snapshot(() => state)
      genui.teardown(async () => {
        await Promise.resolve()
        state = { ...state, tornDown: true }
      })
      document.querySelector("#grow-content").onclick = () => {
        document.querySelector("#resizable-content").style.height = "1000px"
      }
    </script>
  `,
  grant: { surfaceId: "surface-host-context-browser", actions: [], subscriptions: [] },
}

const replacementContextSurface: Surface = {
  id: "surface-host-context-replacement-browser",
  dialect: "code/0",
  content: `
    <output id="replacement-context"></output>
    <output id="replacement-changes">0</output>
    <script type="module">
      let changes = 0
      const render = () => {
        document.querySelector("#replacement-context").textContent =
          JSON.stringify(genui.hostContext)
        document.querySelector("#replacement-changes").textContent = String(changes)
      }
      genui.onHostContextChange(() => {
        changes += 1
        render()
      })
      render()
    </script>
  `,
  grant: {
    surfaceId: "surface-host-context-replacement-browser",
    actions: [],
    subscriptions: [],
  },
}

const syntheticContextSurface: Surface = {
  id: "surface-synthetic-context-browser",
  dialect: "code/0",
  content: `
    <output id="synthetic-context"></output>
    <script type="module">
      let changes = 0
      genui.onHostContextChange(() => {
        changes += 1
      })
      window.dispatchEvent(new MessageEvent("message", {
        source: window.parent,
        data: {
          channel: "genui/dom/0",
          type: "host_context_changed",
          surfaceId: genui.surfaceId,
          context: { locale: "ja-JP" },
        },
      }))
      document.querySelector("#synthetic-context").textContent =
        JSON.stringify({ context: genui.hostContext, changes })
    </script>
  `,
  grant: { surfaceId: "surface-synthetic-context-browser", actions: [], subscriptions: [] },
}

const heartbeatSurface: Surface = {
  id: "surface-heartbeat-browser",
  dialect: "code/0",
  content: `<p id="heartbeat-fixture">Heartbeat fixture</p>`,
  grant: { surfaceId: "surface-heartbeat-browser", actions: [], subscriptions: [] },
}

const capabilitySurface: Surface = {
  id: "surface-capability-browser",
  dialect: "code/0",
  content: `
    <output id="capability-flags"></output>
    <button id="send-message">Send message</button>
    <output id="send-message-result"></output>
    <button id="open-link">Open link</button>
    <output id="open-link-result"></output>
    <button id="update-context">Update context</button>
    <output id="update-context-result"></output>
    <button id="denied-link">Open denied link</button>
    <output id="denied-link-result"></output>
    <script type="module">
      document.querySelector("#capability-flags").textContent = [
        typeof genui.sendMessage,
        typeof genui.openLink,
        typeof genui.updateModelContext,
        Object.hasOwn(genui, "capabilities"),
      ].join(",")

      const run = async (outputId, operation) => {
        const output = document.querySelector(outputId)
        try {
          await operation()
          output.textContent = "ok"
        } catch (error) {
          output.textContent = error.code
        }
      }
      document.querySelector("#send-message").onclick = () => run(
        "#send-message-result",
        () => genui.sendMessage("Show orders 2 and 5"),
      )
      document.querySelector("#open-link").onclick = () => run(
        "#open-link-result",
        () => genui.openLink("https://example.com/orders"),
      )
      document.querySelector("#update-context").onclick = () => run(
        "#update-context-result",
        () => genui.updateModelContext({
          content: "Two orders selected.",
          structuredContent: { selectedOrderIds: ["order-2", "order-5"] },
        }),
      )
      document.querySelector("#denied-link").onclick = () => run(
        "#denied-link-result",
        () => genui.openLink("https://denied.example/orders"),
      )
    </script>
  `,
  grant: { surfaceId: "surface-capability-browser", actions: [], subscriptions: [] },
}

const teardownSurface: Surface = {
  id: "surface-teardown-browser",
  dialect: "code/0",
  content: `
    <output id="teardown-state"></output>
    <script type="module">
      let state = { count: 1 }
      const render = () => {
        document.querySelector("#teardown-state").textContent =
          String(state.count) + ":" + String(state.reason ?? "")
      }
      genui.snapshot((restored) => {
        if (restored && typeof restored.count === "number") state = restored
        render()
        return state
      })
      genui.teardown(async ({ reason }) => {
        await Promise.resolve()
        state = { count: state.count + 1, reason }
        render()
      })
      render()
    </script>
  `,
  grant: { surfaceId: "surface-teardown-browser", actions: [], subscriptions: [] },
}

const restoredTeardownSurface: Surface = {
  ...teardownSurface,
  id: "surface-teardown-restored-browser",
  grant: { surfaceId: "surface-teardown-restored-browser", actions: [], subscriptions: [] },
}

const subscriptionSurface: Surface = {
  id: "surface-subscription-browser",
  dialect: "code/0",
  content: `
    <button id="subscribe">Subscribe</button>
    <output id="subscription-events"></output>
    <output id="subscription-done"></output>
    <script type="module">
      document.querySelector("#subscribe").onclick = async () => {
        const received = []
        let handling = false
        const stream = await genui.subscribe("orders.changes", { status: "processing" },
          async (event) => {
            if (handling) throw new Error("concurrent handler")
            handling = true
            await new Promise((resolve) => setTimeout(resolve, 20))
            received.push({ event, frozen: Object.isFrozen(event) })
            document.querySelector("#subscription-events").textContent = JSON.stringify(received)
            handling = false
          })
        stream.done.then((result) => {
          document.querySelector("#subscription-done").textContent = JSON.stringify(result)
        })
      }
    </script>
  `,
  grant: {
    surfaceId: "surface-subscription-browser",
    actions: [],
    subscriptions: [
      {
        name: "orders.changes",
        description: "Receive order changes.",
        confidentiality: "normal",
        maxEventBytes: subscriptionEventByteLimit,
        eventSchema: { type: "object" },
      },
    ],
  },
}

const newPage = async (): Promise<Page> => {
  if (browser === undefined) throw new Error("Browser was not initialized.")
  const page = await browser.newPage()
  await page.setContent(`<main id="root"></main>`)
  await page.addScriptTag({ content: domBundle })
  return page
}

before(async () => {
  const bundle = await build({
    bundle: true,
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    format: "iife",
    globalName: "GenuiDom",
    platform: "browser",
    write: false,
  })
  domBundle = bundle.outputFiles[0]?.text ?? ""
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
})

void test("guest API exposes commands without grant discovery state", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const runtime = window.GenuiDom
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    runtime.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      onEvent: () => undefined,
    })
  }, guestApiSurface)

  const output = page.frameLocator("iframe").locator("#guest-api")
  await output.waitFor({ state: "visible" })
  assert.deepEqual(JSON.parse((await output.textContent()) ?? "null"), [
    "call",
    "hostContext",
    "onHostContextChange",
    "snapshot",
    "subscribe",
    "surfaceId",
    "teardown",
  ])
})

void test("guest subscriptions receive frozen events sequentially and complete", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const events: SurfaceEvent[] = []
    const subscriptionRequests: unknown[] = []
    const mounted = window.GenuiDom.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      subscriptionTransport: async (request) => {
        subscriptionRequests.push(request)
        return {
          events: {
            async *[Symbol.asyncIterator]() {
              for (const sequence of [1, 2]) {
                yield {
                  type: "event",
                  surfaceId: request.surfaceId,
                  subscriptionId: request.subscriptionId,
                  sequence,
                  event: { sequence },
                }
              }
            },
          },
        }
      },
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, {
      __codeHost: { calls: [], events, mounted, subscriptionRequests },
    })
  }, subscriptionSurface)

  const frame = page.frameLocator("iframe")
  const initialDocumentId = await page
    .locator("iframe")
    .evaluate((iframe) => /"documentId":"([^"]+)"/.exec(iframe.getAttribute("srcdoc") ?? "")?.[1])
  if (initialDocumentId === undefined) throw new Error("Missing initial document ID.")
  await frame.locator("#subscribe").click()
  await frame.locator("#subscription-done").getByText("completed").waitFor()
  assert.deepEqual(
    JSON.parse((await frame.locator("#subscription-events").textContent()) ?? "null"),
    [
      { event: { sequence: 1 }, frozen: true },
      { event: { sequence: 2 }, frozen: true },
    ],
  )
  assert.deepEqual(
    JSON.parse((await frame.locator("#subscription-done").textContent()) ?? "null"),
    { ok: true, reason: "completed" },
  )
  const requests = await page.evaluate(() => window.__codeHost.subscriptionRequests)
  assert.deepEqual(requests, [
    {
      surfaceId: subscriptionSurface.id,
      subscriptionId:
        requests?.[0] !== undefined && typeof requests[0] === "object" && requests[0] !== null
          ? Reflect.get(requests[0], "subscriptionId")
          : "",
      subscription: "orders.changes",
      input: { status: "processing" },
    },
  ])
  assert.equal(
    await page.evaluate(
      () => window.__codeHost.events.filter((event) => event.type === "subscription_event").length,
    ),
    2,
  )

  const replacementDocumentId = await page.evaluate(async (surfaceValue) => {
    await window.__codeHost.mounted.replace(surfaceValue, { snapshot: {} })
    const iframe = document.querySelector("iframe")
    if (iframe === null) throw new Error("Missing subscription iframe.")
    return /"documentId":"([^"]+)"/.exec(iframe.getAttribute("srcdoc") ?? "")?.[1]
  }, subscriptionSurface)
  if (replacementDocumentId === undefined) throw new Error("Missing replacement document ID.")
  assert.notEqual(replacementDocumentId, initialDocumentId)

  const dispatchStart = async (documentId: string, subscriptionId: string): Promise<void> => {
    await page.evaluate(
      ({ documentId, subscriptionId, surfaceId }) => {
        const iframe = document.querySelector("iframe")
        if (iframe === null || iframe.contentWindow === null) throw new Error("Missing iframe.")
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            data: {
              channel: "genui/dom/0",
              type: "subscription_start",
              surfaceId,
              documentId,
              subscriptionId: documentId + ":" + subscriptionId,
              subscription: "orders.changes",
              input: {},
            },
          }),
        )
      },
      { documentId, subscriptionId, surfaceId: subscriptionSurface.id },
    )
  }
  await dispatchStart(initialDocumentId, "stale-subscription")
  await page.waitForTimeout(20)
  assert.equal(await page.evaluate(() => window.__codeHost.subscriptionRequests?.length), 1)
  await dispatchStart(replacementDocumentId, "current-subscription")
  await page.waitForFunction(() => window.__codeHost.subscriptionRequests?.length === 2)
})

void test("guest context, bidirectional sizing, live updates, and teardown compose in a browser", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const events: SurfaceEvent[] = []
    const mounted = window.GenuiDom.mount(root, surfaceValue, {
      hostContext: {
        theme: "dark",
        styles: { variables: { "--color-text-primary": "rgb(1, 2, 3)" } },
        containerDimensions: { width: 320, maxHeight: 180 },
        locale: "en-US",
        timeZone: "UTC",
        platform: "web",
      },
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls: [], events, mounted } })
  }, hostContextSurface)

  const frame = page.frameLocator("iframe")
  const startup = frame.locator("#startup-context")
  await startup.waitFor({ state: "visible" })
  assert.deepEqual(JSON.parse((await startup.textContent()) ?? "null"), {
    context: {
      theme: "dark",
      containerDimensions: { maxHeight: 180, width: 320 },
      locale: "en-US",
      timeZone: "UTC",
      platform: "web",
    },
    frozen: true,
    dimensionsFrozen: true,
  })
  assert.deepEqual(
    await page.locator("iframe").evaluate((iframe) => ({
      maxHeight: iframe.style.maxHeight,
      maxWidth: iframe.style.maxWidth,
    })),
    { maxHeight: "180px", maxWidth: "" },
  )

  await page.waitForFunction(() =>
    window.__codeHost.events.some(
      (event) => event.type === "resize" && event.width === 320 && event.height > 0,
    ),
  )
  const settledResizeCount = await page.evaluate(
    () => window.__codeHost.events.filter((event) => event.type === "resize").length,
  )
  await page.waitForTimeout(200)
  assert.equal(
    await page.evaluate(
      () => window.__codeHost.events.filter((event) => event.type === "resize").length,
    ),
    settledResizeCount,
  )

  await frame.locator("#grow-content").click()
  await page.waitForFunction(() => document.querySelector("iframe")?.style.height === "180px")
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.style.width), "320px")
  assert.deepEqual(await page.evaluate(() => window.__codeHost.events.at(-1)), {
    type: "resize",
    width: 320,
    height: 180,
  })

  await page.evaluate(() =>
    window.__codeHost.mounted.updateHostContext({
      containerDimensions: { maxWidth: 280, maxHeight: 120 },
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      platform: "mobile",
    }),
  )
  const change = frame.locator("#context-change")
  await change.waitFor({ state: "visible" })
  await page.waitForFunction(
    () => document.querySelector("iframe")?.getBoundingClientRect().width === 280,
  )
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.style.height), "120px")
  assert.deepEqual(
    await page.locator("iframe").evaluate((iframe) => ({
      maxHeight: iframe.style.maxHeight,
      maxWidth: iframe.style.maxWidth,
    })),
    { maxHeight: "120px", maxWidth: "280px" },
  )
  assert.deepEqual(JSON.parse((await change.textContent()) ?? "null"), {
    partial: {
      containerDimensions: { maxHeight: 120, maxWidth: 280 },
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      platform: "mobile",
    },
    current: {
      theme: "dark",
      containerDimensions: { maxHeight: 120, maxWidth: 280 },
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      platform: "mobile",
    },
    partialFrozen: true,
    dimensionsFrozen: true,
  })

  await page.locator("iframe").evaluate((iframe) => {
    iframe.style.transform = "scale(0.5)"
  })
  await page.evaluate(() =>
    window.__codeHost.mounted.updateHostContext({
      containerDimensions: { maxWidth: 600, maxHeight: 120 },
    }),
  )
  await page.waitForFunction(() => document.querySelector("iframe")?.clientWidth === 600)
  await page.waitForTimeout(100)
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.clientWidth), 600)
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.style.width), "600px")
  assert.equal(
    await page.locator("iframe").evaluate((iframe) => iframe.getBoundingClientRect().width),
    300,
  )
  assert.equal(await page.locator("iframe").evaluate((iframe) => iframe.style.maxWidth), "600px")

  const finalSnapshot = await page.evaluate(() =>
    window.__codeHost.mounted.teardown({ reason: "browser_test" }),
  )
  assert.deepEqual(finalSnapshot, {
    changes: 2,
    context: {
      theme: "dark",
      containerDimensions: { maxHeight: 120, maxWidth: 600 },
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      platform: "mobile",
    },
    tornDown: true,
  })
  assert.equal(await page.locator("iframe").count(), 0)
})

void test("a replaced document ignores stale host context messages", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const events: SurfaceEvent[] = []
    const mounted = window.GenuiDom.mount(root, surfaceValue, {
      hostContext: { locale: "fr-FR", timeZone: "UTC", platform: "web" },
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls: [], events, mounted } })
  }, hostContextSurface)

  await page.evaluate(async (surfaceValue) => {
    await window.__codeHost.mounted.replace(surfaceValue)
  }, replacementContextSurface)
  const frame = page.frameLocator("iframe")
  const output = frame.locator("#replacement-context")
  await output.waitFor({ state: "visible" })

  await page.evaluate((staleSurfaceId) => {
    document.querySelector("iframe")?.contentWindow?.postMessage(
      {
        channel: "genui/dom/0",
        type: "host_context_changed",
        surfaceId: staleSurfaceId,
        context: { locale: "stale" },
      },
      "*",
    )
  }, hostContextSurface.id)
  await page.waitForTimeout(50)
  assert.deepEqual(JSON.parse((await output.textContent()) ?? "null"), {
    locale: "fr-FR",
    timeZone: "UTC",
    platform: "web",
  })
  assert.equal(await frame.locator("#replacement-changes").textContent(), "0")

  await page.evaluate(() => window.__codeHost.mounted.updateHostContext({ locale: "de-DE" }))
  await frame.locator("#replacement-changes").getByText("1", { exact: true }).waitFor()
  assert.deepEqual(JSON.parse((await output.textContent()) ?? "null"), {
    locale: "de-DE",
    timeZone: "UTC",
    platform: "web",
  })
})

void test("guest code cannot synthesize a parent-sourced context update", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    window.GenuiDom.mount(root, surfaceValue, {
      hostContext: { locale: "en-US" },
      transport: async () => ({ ok: true, value: {} }),
    })
  }, syntheticContextSurface)

  const output = page.frameLocator("iframe").locator("#synthetic-context")
  await output.waitFor({ state: "visible" })
  assert.deepEqual(JSON.parse((await output.textContent()) ?? "null"), {
    context: { locale: "en-US" },
    changes: 0,
  })
})

void test("guest feature-detects and invokes host capabilities", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const capabilityCalls: unknown[] = []
    const events: SurfaceEvent[] = []
    const mounted = window.GenuiDom.mount(root, surfaceValue, {
      capabilities: {
        sendMessage: async (params) => {
          capabilityCalls.push({ capability: "sendMessage", params })
        },
        openLink: async (params) => {
          capabilityCalls.push({ capability: "openLink", params })
          if (params.url.includes("denied.example")) throw new Error("Denied")
        },
        updateModelContext: async (params) => {
          capabilityCalls.push({ capability: "updateModelContext", params })
        },
      },
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls: [], capabilityCalls, events, mounted } })
  }, capabilitySurface)

  const frame = page.frameLocator("iframe")
  await frame.locator("#capability-flags").waitFor({ state: "visible" })
  assert.equal(
    await frame.locator("#capability-flags").textContent(),
    "function,function,function,false",
  )

  for (const [button, output, expected] of [
    ["#send-message", "#send-message-result", "ok"],
    ["#open-link", "#open-link-result", "ok"],
    ["#update-context", "#update-context-result", "ok"],
    ["#denied-link", "#denied-link-result", "denied"],
  ] as const) {
    await frame.locator(button).click()
    await frame.locator(output).waitFor({ state: "visible" })
    assert.equal(await frame.locator(output).textContent(), expected)
  }

  assert.deepEqual(await page.evaluate(() => window.__codeHost.capabilityCalls), [
    {
      capability: "sendMessage",
      params: { role: "user", content: { type: "text", text: "Show orders 2 and 5" } },
    },
    { capability: "openLink", params: { url: "https://example.com/orders" } },
    {
      capability: "updateModelContext",
      params: {
        content: "Two orders selected.",
        structuredContent: { selectedOrderIds: ["order-2", "order-5"] },
      },
    },
    { capability: "openLink", params: { url: "https://denied.example/orders" } },
  ])
})

void test("graceful teardown flushes state for a later remount", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const events: SurfaceEvent[] = []
    const mounted = window.GenuiDom.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls: [], events, mounted } })
  }, teardownSurface)

  const frame = page.frameLocator("iframe")
  await frame.locator("#teardown-state").waitFor({ state: "visible" })
  assert.equal(await frame.locator("#teardown-state").textContent(), "1:")

  const finalSnapshot = await page.evaluate(() =>
    window.__codeHost.mounted.teardown({ reason: "surface_replaced" }),
  )
  assert.deepEqual(finalSnapshot, { count: 2, reason: "surface_replaced" })
  assert.equal(await page.locator("iframe").count(), 0)

  await page.evaluate(
    ({ snapshot, surfaceValue }) => {
      const root = document.querySelector("#root")
      if (root === null) throw new Error("Missing mount root.")
      const events: SurfaceEvent[] = []
      const mounted = window.GenuiDom.mount(root, surfaceValue, {
        snapshot,
        transport: async () => ({ ok: true, value: {} }),
        onEvent: (event) => events.push(event),
      })
      Object.assign(window, { __codeHost: { calls: [], events, mounted } })
    },
    { snapshot: finalSnapshot, surfaceValue: restoredTeardownSurface },
  )

  await frame.locator("#teardown-state").waitFor({ state: "visible" })
  assert.equal(await frame.locator("#teardown-state").textContent(), "2:surface_replaced")
})

void test("red team: heartbeat monitor pauses while hidden and kills a visible silent guest", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    let documentVisible = false
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (documentVisible ? "visible" : "hidden"),
    })
    window.addEventListener(
      "message",
      (event) => {
        const data: unknown = event.data
        if (
          typeof data === "object" &&
          data !== null &&
          Reflect.get(data, "type") === "heartbeat"
        ) {
          event.stopImmediatePropagation()
        }
      },
      true,
    )

    const runtime = window.GenuiDom
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const calls: ActionCall[] = []
    const events: SurfaceEvent[] = []
    const mounted = runtime.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    const setDocumentVisible = (visible: boolean): void => {
      documentVisible = visible
      document.dispatchEvent(new Event("visibilitychange"))
    }
    Object.assign(window, { __codeHost: { calls, events, mounted, setDocumentVisible } })
  }, heartbeatSurface)

  await page.frameLocator("iframe").locator("#heartbeat-fixture").waitFor({ state: "visible" })
  await page.waitForTimeout(7_200)
  assert.equal(await page.locator("iframe").count(), 1)
  assert.equal(
    await page.evaluate(() =>
      window.__codeHost.events.some(
        (event) => event.type === "violation" && event.reason === "unresponsive",
      ),
    ),
    false,
  )

  await page.evaluate(() => window.__codeHost.setDocumentVisible?.(true))
  await page.locator('[role="alert"]').waitFor({ timeout: 9_000 })
  assert.equal(
    await page.locator('[role="alert"]').textContent(),
    "Generated UI became unresponsive.",
  )
  assert.equal(
    await page.evaluate(() =>
      window.__codeHost.events.some(
        (event) => event.type === "violation" && event.reason === "unresponsive",
      ),
    ),
    true,
  )
})

void test("red team: self-navigation kills the surface and emits a violation", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const runtime = window.GenuiDom
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const calls: ActionCall[] = []
    const events: SurfaceEvent[] = []
    const mounted = runtime.mount(root, surfaceValue, {
      transport: async (call) => {
        calls.push(call)
        return { ok: true, value: { total: 6 } }
      },
      hostContext: { containerDimensions: { maxHeight: 80 } },
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls, events, mounted } })
  }, surface)

  const frame = page.frameLocator("iframe")
  await frame.locator("#rendered").waitFor({ state: "visible" })
  assert.equal(await frame.locator("#rendered").textContent(), "Code surface rendered")
  await page.waitForFunction(
    () => document.querySelector("iframe")?.style.height === "80px",
    undefined,
    { timeout: 2_000 },
  )

  await frame.locator("#granted").click()
  await frame.locator("#granted-result").waitFor({ state: "visible" })
  await page.waitForFunction(() => window.__codeHost.calls.length === 1)
  assert.equal(await frame.locator("#granted-result").textContent(), "6")
  assert.deepEqual(await page.evaluate(() => window.__codeHost.calls), [
    {
      surfaceId: surface.id,
      callId: (await page.evaluate(() => window.__codeHost.calls[0]?.callId)) ?? "",
      action: "dice.roll",
      input: { sides: 6 },
    },
  ])

  await frame.locator("#ungranted").click()
  await frame.locator('[data-code="not_granted"]').waitFor({ state: "attached" })
  assert.equal((await page.evaluate(() => window.__codeHost.calls)).length, 1)

  await frame.locator("#navigate").click()
  await page.locator('[role="alert"]').waitFor()
  assert.equal(
    await page.locator('[role="alert"]').textContent(),
    "Generated UI navigation blocked.",
  )
  assert.equal(
    await page.evaluate(() =>
      window.__codeHost.events.some(
        (event) => event.type === "violation" && event.reason === "navigation",
      ),
    ),
    true,
  )
})

void test("browser host theme resolves and survives a snapshot replacement", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const runtime = window.GenuiDom
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const calls: ActionCall[] = []
    const events: SurfaceEvent[] = []
    const mounted = runtime.mount(root, surfaceValue, {
      hostContext: {
        theme: "light",
        styles: {
          variables: {
            "--color-text-primary": "light-dark(rgb(17, 34, 51), rgb(221, 238, 255))",
          },
        },
      },
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    mounted.updateHostContext({ theme: "dark" })
    Object.assign(window, { __codeHost: { calls, events, mounted } })
  }, snapshotSurface)

  const frame = page.frameLocator("iframe")
  const count = frame.locator("#count")
  await count.waitFor({ state: "visible" })
  assert.equal(
    await count.evaluate((element) => getComputedStyle(element).color),
    "rgb(221, 238, 255)",
  )

  await page.evaluate(() => window.__codeHost.mounted.updateHostContext({ theme: "light" }))
  assert.deepEqual(
    await frame.locator("html").evaluate((root) => ({
      colorScheme: getComputedStyle(root).colorScheme,
      theme: root.getAttribute("data-theme"),
    })),
    { colorScheme: "light", theme: "light" },
  )
  assert.equal(
    await count.evaluate((element) => getComputedStyle(element).color),
    "rgb(17, 34, 51)",
  )

  await frame.locator("#increment").click()
  await frame.locator("#increment").click()
  assert.equal(await count.textContent(), "2")
  assert.deepEqual(await page.evaluate(() => window.__codeHost.mounted.snapshot()), { count: 2 })

  await page.evaluate(async (surfaceValue) => {
    await window.__codeHost.mounted.replace(surfaceValue)
    window.__codeHost.mounted.updateHostContext({ theme: "dark" })
  }, snapshotSurface)
  await count.waitFor({ state: "visible" })
  assert.equal(await count.textContent(), "2")
  assert.equal(
    await count.evaluate((element) => getComputedStyle(element).color),
    "rgb(221, 238, 255)",
  )
})
