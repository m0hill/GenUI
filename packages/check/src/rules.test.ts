import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui, subscription, type StandardSchemaV1 } from "genui"
import { checkGeneratedInterface, type GeneratedInterfaceCheckResult } from "./index.js"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const acceptsObject: StandardSchemaV1<unknown, Readonly<Record<string, unknown>>> = {
  "~standard": {
    version: 1,
    vendor: "genui-check-rules-test",
    validate: (value) =>
      isRecord(value) ? { value } : { issues: [{ message: "object required" }] },
  },
}

const acceptsNullableObject: StandardSchemaV1<unknown, Readonly<Record<string, unknown>> | null> = {
  "~standard": {
    version: 1,
    vendor: "genui-check-rules-test",
    validate: (value) =>
      value === null || isRecord(value)
        ? { value }
        : { issues: [{ message: "object or null required" }] },
  },
}

const objectAction = action({
  name: "test.object",
  description: "Accept an object.",
  effect: "read",
  input: acceptsObject,
  inputJsonSchema: { type: "object", additionalProperties: false },
  execute: () => ({}),
})

const nullableAction = action({
  ...objectAction,
  name: "test.nullable",
  input: acceptsNullableObject,
  inputJsonSchema: {
    anyOf: [{ type: "object" }, { type: "null" }],
  },
})

const unknownAction = action({
  ...objectAction,
  name: "test.unknown",
  inputJsonSchema: undefined,
})

const uncertainAction = action({
  ...objectAction,
  name: "test.uncertain",
  inputJsonSchema: { anyOf: [{ type: "object" }, {}] },
})

const objectSubscription = subscription({
  name: "test.events",
  description: "Receive test events.",
  input: acceptsObject,
  inputJsonSchema: { type: "object", additionalProperties: false },
  event: acceptsObject,
  async *subscribe() {},
})

const genui = new Genui({
  actions: [objectAction, nullableAction, unknownAction, uncertainAction],
  subscriptions: [objectSubscription],
})
const generation = genui.generation({
  actions: [objectAction, nullableAction, unknownAction, uncertainAction],
  subscriptions: [objectSubscription],
})

const moduleFragment = (source: string): string =>
  `<main>Rules</main>\n<script type="module">\n${source}\n</script>`

const assertInvalid = (
  result: GeneratedInterfaceCheckResult,
): Extract<GeneratedInterfaceCheckResult, { readonly ok: false }> => {
  assert.equal(result.ok, false)
  if (result.ok) throw new Error("Expected generated content to be invalid.")
  return result
}

const diagnosticCodes = async (content: string): Promise<readonly string[]> => {
  const result = assertInvalid(await checkGeneratedInterface(generation, { content }))
  return result.diagnostics.map(({ code }) => code)
}

void test("PREFLIGHT-NULL-004 rejects only statically incompatible nullish inputs", async () => {
  const rejected = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: moduleFragment(`await genui.call("test.object", null)
await genui.call("test.object", undefined)
await genui.subscribe("test.events", null, () => {})`),
    }),
  )

  assert.deepEqual(
    rejected.diagnostics.filter(({ code }) => code === "GENUI006").map(({ line }) => line),
    [3, 4, 5],
  )
  assert.match(rejected.report, /selected action input excludes null/)
  assert.match(rejected.report, /selected action input excludes undefined/)
  assert.match(rejected.report, /selected subscription input excludes null/)

  assert.deepEqual(
    await checkGeneratedInterface(generation, {
      content: moduleFragment(`await genui.call("test.nullable", null)
await genui.call("test.unknown", null)
await genui.call("test.unknown", undefined)
await genui.call("test.uncertain", null)
await (async (undefined) => genui.call("test.object", undefined))({})`),
    }),
    { ok: true },
  )
})

const moduleRuleCases = [
  ["static import", `import value from "./value.js"`, "GENUI007"],
  ["dynamic import", `await import("./value.js")`, "GENUI007"],
  ["re-export", `export { value } from "./value.js"`, "GENUI007"],
] as const

for (const [name, source, code] of moduleRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name}`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes(code))
  })
}

const networkRuleCases = [
  ["fetch", `await fetch("/data")`],
  ["XMLHttpRequest", `new XMLHttpRequest()`],
  ["WebSocket", `new WebSocket("wss://example.com")`],
  ["EventSource", `new EventSource("/events")`],
  ["WebTransport", `new WebTransport("https://example.com")`],
  ["Worker", `new Worker("worker.js")`],
  ["SharedWorker", `new SharedWorker("worker.js")`],
  ["sendBeacon", `navigator.sendBeacon("/events", "done")`],
  ["service worker", `navigator.serviceWorker.register("worker.js")`],
  ["computed window access", `await self["fetch"]("/data")`],
  ["API reference", `const request = globalThis["fetch"]`],
] as const

for (const [name, source] of networkRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects direct ${name}`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes("GENUI008"))
  })
}

const storageRuleCases = [
  ["local storage", `localStorage.getItem("key")`],
  ["session storage", `sessionStorage.setItem("key", "value")`],
  ["IndexedDB", `indexedDB.open("database")`],
  ["Cache Storage", `await caches.open("cache")`],
  ["Cookie Store", `await cookieStore.get("session")`],
  ["document cookies", `document.cookie = "key=value"`],
  ["computed global access", `globalThis["localStorage"].clear()`],
] as const

for (const [name, source] of storageRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name}`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes("GENUI009"))
  })
}

const parentRuleCases = [
  ["parent", `parent.postMessage("ready", "*")`],
  ["top", `top.location`],
  ["opener", `opener?.postMessage("ready", "*")`],
  ["frame owner", `frameElement?.remove()`],
  ["computed window parent", `window["parent"].postMessage("ready", "*")`],
] as const

for (const [name, source] of parentRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name} access`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes("GENUI010"))
  })
}

const navigationRuleCases = [
  ["window open", `window.open("/next")`],
  ["location write", `location = "/next"`],
  ["location href write", `location.href = "/next"`],
  ["location assign", `location.assign("/next")`],
  ["location replace", `location.replace("/next")`],
  ["location reload", `location.reload()`],
  ["history back", `history.back()`],
  ["history forward", `history.forward()`],
  ["history go", `history.go(-1)`],
  ["history pushState", `history.pushState({}, "", "/next")`],
  ["history replaceState", `history.replaceState({}, "", "/next")`],
  ["Navigation API navigate", `navigation.navigate("/next")`],
  ["Navigation API reload", `navigation.reload()`],
  ["Navigation API traversal", `navigation.traverseTo("key")`],
  ["Navigation API back", `navigation.back()`],
  ["Navigation API forward", `navigation.forward()`],
  ["Navigation API update", `navigation.updateCurrentEntry({ state: {} })`],
] as const

for (const [name, source] of navigationRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name}`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes("GENUI011"))
  })
}

const codeGenerationRuleCases = [
  ["eval", `eval("document.body.textContent = 'replaced'")`],
  ["Function call", `Function("return 1")()`],
  ["Function construction", `new Function("return 1")`],
  ["string timeout", `setTimeout("document.body.remove()", 0)`],
  ["string interval", "setInterval(`document.body.remove()`, 100)"],
  ["interpolated string timer", "setTimeout(`remove-${document.body.id}`, 0)"],
] as const

for (const [name, source] of codeGenerationRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name}`, async () => {
    assert.ok((await diagnosticCodes(moduleFragment(source))).includes("GENUI012"))
  })
}

void test("PREFLIGHT-ENVIRONMENT-005 rejects document.currentScript", async () => {
  assert.ok(
    (
      await diagnosticCodes(
        moduleFragment(`document.currentScript
globalThis["document"]["currentScript"]`),
      )
    ).includes("GENUI013"),
  )
})

const structureRuleCases = [
  ["external stylesheet", `<link rel="stylesheet" href="/theme.css">`],
  ["CSS import", `<style>\n@import url("/theme.css");\n</style>`],
  ["iframe", `<iframe srcdoc="<p>nested</p>"></iframe>`],
  ["frame", `<frame src="/nested">`],
  ["embed", `<embed src="/document.pdf">`],
  ["object", `<object data="/document.pdf"></object>`],
  ["base", `<base href="/root/">`],
  ["refresh", `<meta http-equiv="refresh" content="0;url=/next">`],
  ["anchor destination", `<a href="/next">Next</a>`],
  ["area destination", `<map><area href="/next"></map>`],
  ["navigation target", `<a href="#section" target="_top">Section</a>`],
  ["form action", `<form action="/submit"><button>Submit</button></form>`],
  ["button form action", `<form><button formaction="/submit">Submit</button></form>`],
  ["form target", `<form target="_blank"><button>Submit</button></form>`],
] as const

for (const [name, content] of structureRuleCases) {
  void test(`PREFLIGHT-ENVIRONMENT-005 rejects ${name} structure`, async () => {
    assert.ok((await diagnosticCodes(content)).includes("GENUI014"))
  })
}

void test("PREFLIGHT-ENVIRONMENT-005 accepts fragment links and locally shadowed names", async () => {
  const result = await checkGeneratedInterface(generation, {
    content: `<a href="#details">Details</a>
<img src="https://example.com/host-policy-owned.png" alt="Example" />
<style>
  /* @import rules mentioned in comments do not load anything. */
</style>
<script type="module">
  const fetch = async () => ({ ok: true })
  const localStorage = { getItem: (_key) => null }
  const parent = { postMessage: (_message, _target) => {} }
  const window = { fetch, open: () => {}, parent }
  const document = { cookie: "", currentScript: { dataset: {} } }
  const navigator = { sendBeacon: () => true, serviceWorker: { register: async () => {} } }
  const history = { pushState: () => {} }
  const navigation = { navigate: () => {} }
  const Function = (_source) => () => 1
  const setTimeout = (callback, _delay) => callback()
  const client = { fetch: async () => ({}), sendBeacon: () => true }
  const exampleMarkup = "<frame src='/example'>"

  await fetch()
  localStorage.getItem("key")
  parent.postMessage("ready", "*")
  window.fetch()
  window.open()
  document.cookie
  document.currentScript
  navigator.sendBeacon()
  await navigator.serviceWorker.register()
  history.pushState()
  navigation.navigate()
  Function("return 1")()
  setTimeout(() => {}, 0)
  await client.fetch()
  client.sendBeacon()
  exampleMarkup.length
</script>`,
  })

  assert.deepEqual(result, { ok: true })
})

void test("stable diagnostics keep fragment locations and deterministic order", async () => {
  const result = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<style>\n  @import "/theme.css";\n</style>\n<script type="module">\n  document.currentScript\n  await fetch("/data")\n</script>`,
    }),
  )

  assert.deepEqual(
    result.diagnostics
      .filter(({ code }) => code.startsWith("GENUI"))
      .map(({ code, line, column }) => ({
        code,
        line,
        column,
      })),
    [
      { code: "GENUI014", line: 2, column: 3 },
      { code: "GENUI013", line: 5, column: 3 },
      { code: "GENUI008", line: 6, column: 9 },
    ],
  )
})
