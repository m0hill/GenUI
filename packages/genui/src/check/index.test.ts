import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui, subscription } from "../registry.js"
import { isRecord, testSchema } from "../test-schema.test-support.js"
import { checkGeneratedInterface, type GeneratedInterfaceCheckResult } from "./index.js"

const searchOrders = action({
  name: "orders.search",
  description: "Search orders.",
  effect: "read",
  input: testSchema<Readonly<{ query: string }>>((value) =>
    isRecord(value) && typeof value.query === "string"
      ? { ok: true, value: { query: value.query } }
      : { ok: false, message: "query required" },
  ),
  inputJsonSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  output: testSchema<Readonly<{ ids: readonly string[] }>>((value) =>
    isRecord(value) && Array.isArray(value.ids)
      ? { ok: true, value: { ids: value.ids.filter((id): id is string => typeof id === "string") } }
      : { ok: false, message: "ids required" },
  ),
  outputJsonSchema: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string" } } },
    required: ["ids"],
    additionalProperties: false,
  },
  execute: () => ({ ids: [] }),
})

const searchWeb = action({
  ...searchOrders,
  name: "web.search",
  description: "Search the web.",
})

const orderChanges = subscription({
  name: "orders.changes",
  description: "Receive order changes.",
  input: testSchema<Readonly<{ status?: "open" | "shipped" }>>((value) =>
    isRecord(value) ? { ok: true, value: {} } : { ok: false, message: "object required" },
  ),
  inputJsonSchema: {
    type: "object",
    properties: { status: { type: "string", enum: ["open", "shipped"] } },
    additionalProperties: false,
  },
  event: testSchema<Readonly<{ id: string }>>((value) =>
    isRecord(value) && typeof value.id === "string"
      ? { ok: true, value: { id: value.id } }
      : { ok: false, message: "id required" },
  ),
  eventJsonSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  async *subscribe() {},
})

const genui = new Genui({ actions: [searchOrders, searchWeb], subscriptions: [orderChanges] })
const generation = genui.generation({
  actions: [searchOrders, searchWeb],
  subscriptions: [orderChanges],
})

const assertInvalid = (
  result: GeneratedInterfaceCheckResult,
): Extract<GeneratedInterfaceCheckResult, { readonly ok: false }> => {
  assert.equal(result.ok, false)
  if (result.ok) throw new Error("Expected generated content to be invalid.")
  return result
}

void test("checker accepts ordinary DOM code using selected commands", async () => {
  const result = await checkGeneratedInterface(generation, {
    content: `<section>
  <button id="search">Search</button>
  <output id="result"></output>
  <script type="module">
    const output = document.querySelector("#result")
    document.querySelector("#search").onclick = async () => {
      try {
        const result = await genui.call("orders.search", { query: "open" })
        await genui.call("web.search", { query: "GenUI" })
        output.textContent = result.ids.join(",")
      } catch (error) {
        output.textContent = error.message
      }
    }
  </script>
</section>`,
  })

  assert.deepEqual(result, { ok: true })
})

void test("checker rejects nonexistent guest properties and unknown commands", async () => {
  const result = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script type="module">
  genui.capabilities.webSearch
  await genui.call("web.missing", { query: "GenUI" })
  await genui.subscribe("orders.missing", {}, () => {})
</script>`,
    }),
  )

  assert.equal(result.diagnostics.length, 3)
  assert.match(result.report, /capabilities/)
  assert.match(result.report, /web\.missing/)
  assert.match(result.report, /orders\.missing/)
})

void test("checker rejects incompatible literal inputs", async () => {
  const result = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script type="module">
  await genui.call("orders.search", { query: 42 })
  await genui.subscribe("orders.changes", { status: "deleted" }, () => {})
</script>`,
    }),
  )

  assert.equal(result.diagnostics.length, 2)
  assert.match(result.report, /number.*string/s)
  assert.match(result.report, /deleted/)
})

void test("checker fails closed for unsupported and malformed scripts", async () => {
  const unsupported = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script>genui.call("orders.search", { query: "open" })</script>`,
    }),
  )
  assert.match(unsupported.report, /type="module"/)

  const external = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script type="module" src="https://example.com/interface.js"></script>`,
    }),
  )
  assert.match(external.report, /must be inline/)

  const malformed = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script type="module">const value = ;</script>`,
    }),
  )
  assert.match(malformed.report, /Expression expected/)
})

void test("checker reads the current capability projection", async () => {
  const mutableAction = action({
    ...searchOrders,
    name: "orders.current",
    policy: "allow",
  })
  const mutableGenui = new Genui({ actions: [mutableAction] })
  const mutableGeneration = mutableGenui.generation({ actions: [mutableAction] })

  Reflect.set(mutableAction, "policy", "block")
  const result = assertInvalid(
    await checkGeneratedInterface(mutableGeneration, {
      content: `<script type="module">await genui.call("orders.current", { query: "open" })</script>`,
    }),
  )

  assert.match(result.report, /orders\.current/)
})

void test("checker honors an already-aborted signal", async () => {
  const controller = new AbortController()
  const reason = new Error("generation request ended")
  controller.abort(reason)

  await assert.rejects(
    checkGeneratedInterface(generation, {
      content: `<p>not checked</p>`,
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

void test("checker returns bounded serializable diagnostics", async () => {
  const invalidLines = Array.from(
    { length: 20 },
    (_, index) => `genui.missing${String(index)}()`,
  ).join("\n")
  const result = assertInvalid(
    await checkGeneratedInterface(generation, {
      content: `<script type="module">\n${invalidLines}\n</script>`,
    }),
  )

  assert.equal(result.diagnostics.length <= 8, true)
  assert.equal(result.report.length <= 8_000, true)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})
