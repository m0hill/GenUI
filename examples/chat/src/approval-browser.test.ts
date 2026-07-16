import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { serve, type ServerType } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { chromium, type Browser } from "playwright"
import { Hono } from "hono"
import { generatedUi } from "./ai/genui.js"
import { createAuthenticatedSessions } from "./authenticated-session.js"
import { createGenuiRoutes } from "./genui-routes.js"
import { JsonPreferenceStore } from "./preferences.js"
import { JsonlChatSession } from "./session.js"

let browser: Browser | undefined
let server: ServerType | undefined
let origin = ""
let directory = ""
let preferences: JsonPreferenceStore | undefined

const escapeSingleQuotedHtmlAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("'", "&#39;")

const pageFixture = (surface: unknown, csrfToken: string): string => `<!doctype html>
<meta name="chat-csrf" content="${csrfToken}">
<div class="genui-surface" data-genui-surface='${escapeSingleQuotedHtmlAttribute(JSON.stringify(surface))}'>Loading</div>
<script type="module" src="/assets/client.js"></script>`

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "genui-chat-browser-"))
  const sessions = createAuthenticatedSessions()
  const session = sessions.create()
  const chatSession = await JsonlChatSession.open(join(directory, "chat.jsonl"))
  preferences = new JsonPreferenceStore(join(directory, "preferences.json"))
  const surface = await generatedUi.createSurface({
    subject: session.subject,
    content: `<button id="save">Save</button><output id="result"></output><script type="module">
      window.__chatBoundaryMessages = []
      window.addEventListener("message", (event) => window.__chatBoundaryMessages.push(event.data))
      document.querySelector("#save").onclick = async () => {
        try { document.querySelector("#result").textContent = JSON.stringify(await genui.call("preferences.save", { preference: "City" })) }
        catch (error) { document.querySelector("#result").textContent = error instanceof Error ? error.message : "error" }
      }
    </script>`,
  })
  const app = new Hono()
  app.use(
    "/assets/*",
    serveStatic({
      root: fileURLToPath(new URL("../public", import.meta.url)),
      rewriteRequestPath: (path: string) => path.replace(/^\/assets/, ""),
    }),
  )
  app.get("/", (context) =>
    context.html(pageFixture(surface, session.csrfToken), 200, {
      "set-cookie": `chat_session=${session.credential}; Path=/`,
    }),
  )
  app.route("/genui", createGenuiRoutes({ sessions, chatSession, preferences }))
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
  await new Promise<void>((resolve, reject) =>
    server === undefined
      ? resolve()
      : server.close((error?: Error) => (error === undefined ? resolve() : reject(error))),
  )
  await rm(directory, { recursive: true, force: true })
})

void test("CHAT-APR-006 denies without exchange or retry", async (context) => {
  if (browser === undefined) throw new Error("Browser is unavailable.")
  if (preferences === undefined) throw new Error("Preference store is unavailable.")
  const page = await browser.newPage()
  context.after(() => page.close())
  const paths: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/genui/"))
      paths.push(new URL(request.url()).pathname)
  })
  page.once("dialog", (dialog) => dialog.dismiss())
  await page.goto(origin)
  const frame = page.frameLocator(".genui-surface iframe")
  await frame.locator("#save").click()
  await frame.locator("#result").getByText("Action was denied.").waitFor()
  assert.deepEqual(paths, ["/genui/execute"])
  assert.equal(await preferences.get(), undefined)
})

void test("CHAT-APR-012 and CHAT-APR-013 approve once and confine authority to the trusted parent", async (context) => {
  if (browser === undefined) throw new Error("Browser is unavailable.")
  if (preferences === undefined) throw new Error("Preference store is unavailable.")
  const page = await browser.newPage()
  context.after(() => page.close())
  const requests: { readonly path: string; readonly body: unknown }[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/genui/"))
      requests.push({
        path: new URL(request.url()).pathname,
        body: JSON.parse(request.postData() ?? "null"),
      })
  })
  page.once("dialog", (dialog) => dialog.accept())
  await page.goto(origin)
  const frame = page.frameLocator(".genui-surface iframe")
  await frame.locator("#save").click()
  await frame.locator("#result").getByText('{"preference":"City"}').waitFor()
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/genui/execute", "/genui/approve", "/genui/execute"],
  )
  const [first, approval, retry] = requests
  assert.ok(first?.body && approval?.body && retry?.body)
  assert.equal(Object.hasOwn(first.body as object, "approvalRetryToken"), false)
  assert.equal(Object.hasOwn(approval.body as object, "pendingApproval"), true)
  assert.equal(typeof (retry.body as { approvalRetryToken?: unknown }).approvalRetryToken, "string")
  assert.equal(
    (first.body as { call: { callId: string } }).call.callId,
    (retry.body as { call: { callId: string } }).call.callId,
  )
  const pendingToken = (approval.body as { pendingApproval: { token: string } }).pendingApproval
    .token
  const retryToken = (retry.body as { approvalRetryToken: string }).approvalRetryToken
  const sandboxMessages = await frame
    .locator("body")
    .evaluate(() =>
      JSON.stringify(
        (window as unknown as { __chatBoundaryMessages?: readonly unknown[] })
          .__chatBoundaryMessages ?? [],
      ),
    )
  assert.equal(
    sandboxMessages.includes(pendingToken) || sandboxMessages.includes(retryToken),
    false,
  )
  const saved = await preferences.get()
  assert.deepEqual(saved, {
    preferredTrip: "City",
    updatedAt: saved?.updatedAt,
  })
})

void test("CHAT-APR-011 rejects an inconsistent execute envelope at the browser boundary", async (context) => {
  if (browser === undefined) throw new Error("Browser is unavailable.")
  if (preferences === undefined) throw new Error("Preference store is unavailable.")
  const page = await browser.newPage()
  context.after(() => page.close())
  const paths: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/genui/"))
      paths.push(new URL(request.url()).pathname)
  })
  await page.route("**/genui/execute", async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as {
      readonly result: unknown
      readonly pendingApproval?: Readonly<Record<string, unknown>>
    }
    assert.ok(body.pendingApproval)
    await route.fulfill({
      response,
      json: {
        ...body,
        pendingApproval: { ...body.pendingApproval, callId: "forged-call" },
      },
    })
  })
  const saved = await preferences.get()

  await page.goto(origin)
  const frame = page.frameLocator(".genui-surface iframe")
  await frame.locator("#save").click()
  await frame.locator("#result").getByText("The GenUI action returned an invalid result.").waitFor()
  assert.deepEqual(paths, ["/genui/execute"])
  assert.deepEqual(await preferences.get(), saved)
})

void test("CHAT-APR-004 rejects a forged canonical input without a browser retry", async (context) => {
  if (browser === undefined) throw new Error("Browser is unavailable.")
  if (preferences === undefined) throw new Error("Preference store is unavailable.")
  const page = await browser.newPage()
  context.after(() => page.close())
  const paths: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/genui/"))
      paths.push(new URL(request.url()).pathname)
  })
  await page.route("**/genui/execute", async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as {
      readonly result: unknown
      readonly pendingApproval?: Readonly<Record<string, unknown>>
    }
    assert.ok(body.pendingApproval)
    await route.fulfill({
      response,
      json: {
        ...body,
        pendingApproval: {
          ...body.pendingApproval,
          input: { preference: "Mountain" },
        },
      },
    })
  })
  page.once("dialog", (dialog) => dialog.accept())
  const saved = await preferences.get()

  await page.goto(origin)
  const frame = page.frameLocator(".genui-surface iframe")
  await frame.locator("#save").click()
  await frame.locator("#result").getByText("Action failed.").waitFor()
  assert.deepEqual(paths, ["/genui/execute", "/genui/approve"])
  assert.deepEqual(await preferences.get(), saved)
})

void test("CHAT-APR-011 rejects a malformed approval response without a browser retry", async (context) => {
  if (browser === undefined) throw new Error("Browser is unavailable.")
  if (preferences === undefined) throw new Error("Preference store is unavailable.")
  const page = await browser.newPage()
  context.after(() => page.close())
  const paths: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/genui/"))
      paths.push(new URL(request.url()).pathname)
  })
  await page.route("**/genui/approve", async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as Readonly<Record<string, unknown>>
    await route.fulfill({ response, json: { ...body, extra: true } })
  })
  page.once("dialog", (dialog) => dialog.accept())
  const saved = await preferences.get()

  await page.goto(origin)
  const frame = page.frameLocator(".genui-surface iframe")
  await frame.locator("#save").click()
  await frame.locator("#result").getByText("Action failed.").waitFor()
  assert.deepEqual(paths, ["/genui/execute", "/genui/approve"])
  assert.deepEqual(await preferences.get(), saved)
})
