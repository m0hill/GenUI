import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import type { ActionCall, ActionResult, Surface } from "@genui/protocol"
import type { Mounted, SurfaceEvent } from "./index.js"

let browser: Browser | undefined
let domBundle = ""

interface BrowserDomRuntime {
  mount(
    element: Element,
    surface: Surface,
    options: {
      readonly transport: (call: ActionCall) => Promise<ActionResult>
      readonly onEvent: (event: SurfaceEvent) => void
      readonly maxHeight?: number
    },
  ): Mounted
}

interface CodeHostState {
  readonly calls: ActionCall[]
  readonly events: SurfaceEvent[]
  readonly mounted: Mounted
  readonly setDocumentVisible?: (visible: boolean) => void
}

declare global {
  interface Window {
    readonly __codeHost: CodeHostState
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
  },
}

const snapshotSurface: Surface = {
  id: "surface-snapshot-browser",
  dialect: "code/0",
  content: `
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
  grant: { surfaceId: "surface-snapshot-browser", actions: [] },
}

const startupGrantSurface: Surface = {
  id: "surface-startup-grant-browser",
  dialect: "code/0",
  content: `
    <output id="startup-actions"></output>
    <script type="module">
      document.querySelector("#startup-actions").textContent =
        genui.actions.map((action) => action.name).join(",")
    </script>
  `,
  grant: {
    surfaceId: "surface-startup-grant-browser",
    actions: surface.grant.actions,
  },
}

const heartbeatSurface: Surface = {
  id: "surface-heartbeat-browser",
  dialect: "code/0",
  content: `<p id="heartbeat-fixture">Heartbeat fixture</p>`,
  grant: { surfaceId: "surface-heartbeat-browser", actions: [] },
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

void test("guest startup scripts receive the embedded grant", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const runtime = Reflect.get(window, "GenuiDom") as BrowserDomRuntime
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    runtime.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      onEvent: () => undefined,
    })
  }, startupGrantSurface)

  const output = page.frameLocator("iframe").locator("#startup-actions")
  await output.waitFor({ state: "visible" })
  assert.equal(await output.textContent(), "dice.roll")
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

    const runtime = Reflect.get(window, "GenuiDom") as BrowserDomRuntime
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
    const runtime = Reflect.get(window, "GenuiDom") as BrowserDomRuntime
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const calls: ActionCall[] = []
    const events: SurfaceEvent[] = []
    const mounted = runtime.mount(root, surfaceValue, {
      transport: async (call) => {
        calls.push(call)
        return { ok: true, value: { total: 6 } }
      },
      maxHeight: 80,
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

void test("browser snapshot survives a same-surface replacement", async (context) => {
  const page = await newPage()
  context.after(async () => {
    await page.close()
  })

  await page.evaluate((surfaceValue) => {
    const runtime = Reflect.get(window, "GenuiDom") as BrowserDomRuntime
    const root = document.querySelector("#root")
    if (root === null) throw new Error("Missing mount root.")
    const calls: ActionCall[] = []
    const events: SurfaceEvent[] = []
    const mounted = runtime.mount(root, surfaceValue, {
      transport: async () => ({ ok: true, value: {} }),
      onEvent: (event) => events.push(event),
    })
    Object.assign(window, { __codeHost: { calls, events, mounted } })
  }, snapshotSurface)

  const frame = page.frameLocator("iframe")
  await frame.locator("#increment").click()
  await frame.locator("#increment").click()
  assert.equal(await frame.locator("#count").textContent(), "2")
  assert.deepEqual(await page.evaluate(() => window.__codeHost.mounted.snapshot()), { count: 2 })

  await page.evaluate(
    (surfaceValue) => window.__codeHost.mounted.replace(surfaceValue),
    snapshotSurface,
  )
  await frame.locator("#count").waitFor({ state: "visible" })
  assert.equal(await frame.locator("#count").textContent(), "2")
})
