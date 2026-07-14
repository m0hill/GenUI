import assert from "node:assert/strict"
import { test } from "node:test"
import {
  action,
  Genui,
  readGenerationCheckerContract,
  subscription,
  type Generation,
  type StandardSchemaV1,
} from "genui"
import {
  createGeneratedInterfaceChecker,
  typescriptGeneratedInterfaceCompiler,
  type GeneratedInterfaceCompiler,
} from "./checker.js"
import {
  checkGeneratedInterface,
  GeneratedInterfaceCheckError,
  type GeneratedInterfaceCheckResult,
} from "./index.js"

type TestParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const testSchema = <Value>(
  parse: (value: unknown) => TestParseResult<Value>,
): StandardSchemaV1<unknown, Value> => ({
  "~standard": {
    version: 1,
    vendor: "genui-check-test",
    validate(value) {
      const result = parse(value)
      return result.ok ? { value: result.value } : { issues: [{ message: result.message }] }
    },
  },
})

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

const assertOperationalError =
  (code: GeneratedInterfaceCheckError["code"], cause?: unknown): ((error: unknown) => boolean) =>
  (error) => {
    assert.ok(error instanceof GeneratedInterfaceCheckError)
    assert.equal(error.name, "GeneratedInterfaceCheckError")
    assert.equal(error.code, code)
    if (cause !== undefined) assert.equal(error.cause, cause)
    return true
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

void test("checker ignores DOM element specialization in a web-search panel", async () => {
  const result = await checkGeneratedInterface(generation, {
    content: `<section>
  <form id="search-form">
    <input id="query" name="query" type="search" />
    <button id="search" type="submit">Search</button>
  </form>
  <p id="loading" hidden>Searching…</p>
  <output id="results"></output>
  <p id="error" hidden></p>
  <script type="module">
    const form = document.getElementById("search-form")
    const query = document.getElementById("query")
    const search = document.getElementById("search")
    const loading = document.getElementById("loading")
    const results = document.getElementById("results")
    const error = document.getElementById("error")
    let state = { query: "", ids: [] }

    genui.snapshot((restored) => {
      if (restored) {
        state.query = typeof restored.query === "string" ? restored.query : ""
        state.ids = Array.isArray(restored.ids) ? restored.ids : []
      }
      return state
    })

    form.addEventListener("submit", async (event) => {
      event.preventDefault()
      const formValue = new FormData(form).get("query")
      const value = typeof formValue === "string" ? formValue.trim() : ""
      error.hidden = true
      loading.hidden = false
      search.disabled = true
      try {
        const found = await genui.call("web.search", { query: value })
        state = { query: value, ids: [...found.ids] }
        results.textContent = found.ids.join(", ")
      } catch (cause) {
        error.textContent = cause.message
        error.hidden = false
      } finally {
        loading.hidden = true
        search.disabled = false
      }
    })
  </script>
</section>`,
  })

  assert.deepEqual(result, { ok: true })
})

void test("PREFLIGHT-CAPABILITY-003 rejects selected-contract mistakes", async () => {
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

void test("PREFLIGHT-OPERATIONAL-008 preserves a pre-aborted signal reason", async () => {
  const controller = new AbortController()
  const reason = { code: "generation_request_ended" }
  controller.abort(reason)

  await assert.rejects(
    checkGeneratedInterface(generation, {
      content: `<p>not checked</p>`,
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

void test("PREFLIGHT-OPERATIONAL-008 preserves cancellation after compiler work", async () => {
  const controller = new AbortController()
  const reason = { code: "generation_request_ended" }
  const compiler: GeneratedInterfaceCompiler = {
    check: async () => {
      controller.abort(reason)
      return { ok: true, diagnostics: [] }
    },
  }
  const check = createGeneratedInterfaceChecker({
    compiler,
    readContract: readGenerationCheckerContract,
  })

  await assert.rejects(
    check(generation, {
      content: `<script type="module">document.body.textContent = "done"</script>`,
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

void test("PREFLIGHT-OPERATIONAL-008 rejects incompatible Generation contracts", async () => {
  const counterfeitGeneration = {
    guidance: () => ({ environment: "", capabilityContract: "" }),
    createSurface: async () => {
      throw new Error("not implemented")
    },
  } satisfies Generation

  await assert.rejects(
    checkGeneratedInterface(counterfeitGeneration, { content: "<p>Counterfeit</p>" }),
    assertOperationalError("incompatible_generation"),
  )

  for (const [property, value] of [
    ["version", 2],
    ["dialect", "code/unknown"],
  ] as const) {
    const contract = readGenerationCheckerContract(generation)
    assert.ok(contract)
    Reflect.set(contract, property, value)
    const check = createGeneratedInterfaceChecker({
      compiler: {
        check: async () => {
          throw new Error("incompatible contracts must not reach the compiler")
        },
      },
      readContract: () => contract,
    })

    await assert.rejects(
      check(generation, { content: `<script type="module"></script>` }),
      assertOperationalError("incompatible_generation"),
    )
  }
})

void test("PREFLIGHT-OPERATIONAL-008 classifies expected compiler failures", async () => {
  for (const code of ["compiler_unavailable", "invalid_configuration"] as const) {
    const cause = new Error(`${code} cause`)
    const check = createGeneratedInterfaceChecker({
      compiler: { check: async () => ({ ok: false, code, cause }) },
      readContract: readGenerationCheckerContract,
    })

    await assert.rejects(
      check(generation, { content: `<script type="module"></script>` }),
      assertOperationalError(code, cause),
    )
  }

  const malformedContract = readGenerationCheckerContract(generation)
  assert.ok(malformedContract)
  Reflect.set(malformedContract, "guestDeclarations", "interface {")
  const checkMalformedDeclarations = createGeneratedInterfaceChecker({
    compiler: typescriptGeneratedInterfaceCompiler,
    readContract: () => malformedContract,
  })
  await assert.rejects(
    checkMalformedDeclarations(generation, {
      content: `<script type="module"></script>`,
    }),
    assertOperationalError("invalid_configuration"),
  )
})

void test("PREFLIGHT-OPERATIONAL-008 bounds unexpected implementation failures", async () => {
  const cause = new Error("private compiler stack detail")
  const check = createGeneratedInterfaceChecker({
    compiler: {
      check: async () => {
        throw cause
      },
    },
    readContract: readGenerationCheckerContract,
  })

  await assert.rejects(
    check(generation, { content: `<script type="module"></script>` }),
    (error: unknown) => {
      assertOperationalError("internal_error", cause)(error)
      assert.ok(error instanceof GeneratedInterfaceCheckError)
      assert.doesNotMatch(error.message, /private compiler stack detail/)
      return true
    },
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
