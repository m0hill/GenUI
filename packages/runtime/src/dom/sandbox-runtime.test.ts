import assert from "node:assert/strict"
import { test } from "node:test"
import { Window } from "happy-dom"
import { protocolChannel } from "./protocol.js"
import {
  installSandboxRuntime,
  type SandboxRuntimeGlobal,
  type SandboxRuntimeInstance,
  type SandboxRuntimeLanguage,
} from "./sandbox-runtime.js"

interface RuntimeHarness {
  readonly window: Window
  readonly messages: unknown[]
  readonly instance: SandboxRuntimeInstance
}

const invalid = Symbol("invalid")

const literalValue = (source: string): unknown => {
  const value = source.trim()
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return invalid
}

const language: SandboxRuntimeLanguage = {
  invalid,
  parseObjectLiteral(source, readSignal) {
    const body = source.trim().slice(1, -1).trim()
    if (body.length === 0) return {}

    const output: Record<string, unknown> = {}
    for (const entry of body.split(",")) {
      const [rawKey, rawValue] = entry.split(":")
      if (rawKey === undefined || rawValue === undefined) return invalid
      const key = rawKey.trim()
      const value = rawValue.trim()
      output[key] = value.startsWith("$") ? readSignal(value) : literalValue(value)
      if (output[key] === invalid) return invalid
    }
    return output
  },
  evaluateExpression(source, readSignal) {
    const value = source.trim()
    const equality = value.match(/^(.+)\s*(==|!=)\s*(.+)$/)
    if (equality !== null) {
      const leftSource = equality[1]
      const operator = equality[2]
      const rightSource = equality[3]
      if (leftSource === undefined || operator === undefined || rightSource === undefined) {
        return invalid
      }
      const left = leftSource.trim().startsWith("$")
        ? readSignal(leftSource.trim())
        : literalValue(leftSource)
      const right = rightSource.trim().startsWith("$")
        ? readSignal(rightSource.trim())
        : literalValue(rightSource)
      if (left === invalid || right === invalid) return invalid
      return operator === "==" ? Object.is(left, right) : !Object.is(left, right)
    }

    if (value.startsWith("$")) return readSignal(value)
    return literalValue(value)
  },
  parseCapabilityExpression(expression, readSignal) {
    if (expression === "roll") {
      return {
        capability: "dice.roll",
        input: {
          label: readSignal("$label"),
          sides: readSignal("$sides"),
          missing: readSignal("$missing"),
        },
        target: "rollResult",
      }
    }

    if (expression === "lookup") {
      return { capability: "weather.lookup", input: { city: readSignal("$city") } }
    }

    if (expression === "save") {
      return {
        capability: "notes.create",
        input: { total: readSignal("$rollResult.value.total") },
      }
    }

    return undefined
  },
  defaultResultTarget(capability) {
    if (capability === "weather.lookup") return "weatherLookup"
    if (capability === "notes.create") return "notesCreate"
    return "diceRoll"
  },
}

const asSandboxGlobal = (window: Window): SandboxRuntimeGlobal => {
  // SAFETY: happy-dom's Window exposes the browser APIs used by the sandbox runtime. Its
  // TypeScript classes are separate from lib.dom classes even though the runtime API matches here.
  return window as unknown as SandboxRuntimeGlobal
}

const createHarness = (html: string, surfaceId = "surface-test"): RuntimeHarness => {
  const window = new Window()
  const messages: unknown[] = []

  window.document.body.innerHTML = html
  window.parent.postMessage = (message: unknown): void => {
    messages.push(message)
  }

  const instance = installSandboxRuntime(
    { channel: protocolChannel, surfaceId },
    language,
    asSandboxGlobal(window),
  )

  return { window, messages, instance }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const capabilityMessage = (messages: readonly unknown[]): Readonly<Record<string, unknown>> => {
  const message = messages.find(
    (candidate) => isRecord(candidate) && candidate.type === "capability",
  )
  assert.notEqual(message, undefined)
  assert.ok(isRecord(message))
  return message
}

const jsonRoundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const displayStyle = (element: unknown): string => {
  assert.notEqual(element, null)
  // SAFETY: these fixtures select HTML elements created by happy-dom. Its Element type is not
  // assignable to lib.dom's HTMLElement even though the runtime exposes the same style API here.
  return (element as unknown as HTMLElement).style.display
}

void test("sandbox runtime posts capability calls from click actions", () => {
  const { window, messages } = createHarness(`
    <div data-signals="{ label: 'Fallback' }">
      <input data-bind="label" value="Lucky">
      <input data-bind="sides" type="number" value="6">
      <button data-on:click="roll">Roll</button>
    </div>
  `)

  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  const message = capabilityMessage(messages)
  assert.equal(message.channel, protocolChannel)
  assert.equal(message.surfaceId, "surface-test")
  assert.equal(message.capability, "dice.roll")
  assert.equal(typeof message.callId, "string")
  assert.equal(message.target, "rollResult")
  assert.deepEqual(jsonRoundTrip(message.input), {
    label: "Lucky",
    sides: 6,
    missing: "",
  })
})

void test("sandbox runtime posts capability calls from prevented submit actions", () => {
  const { window, messages } = createHarness(`
    <form data-on:submit__prevent="lookup">
      <input data-bind="city" value="Tokyo">
      <button>Search</button>
    </form>
  `)
  const form = window.document.querySelector("form")
  assert.notEqual(form, null)

  const defaultAllowed = form?.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  )

  assert.equal(defaultAllowed, false)
  const message = capabilityMessage(messages)
  assert.equal(message.capability, "weather.lookup")
  assert.deepEqual(jsonRoundTrip(message.input), { city: "Tokyo" })
  assert.equal(message.target, undefined)
})

void test("sandbox runtime exposes result state to later capability inputs", () => {
  const { window, messages } = createHarness(`
    <button data-on:click="save">Save</button>
  `)

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "rollResult",
        state: { status: "complete", value: { total: 6 } },
      },
    }),
  )
  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  const message = capabilityMessage(messages)
  assert.equal(message.capability, "notes.create")
  assert.deepEqual(jsonRoundTrip(message.input), { total: 6 })
})

void test("sandbox runtime renders capability pending, success, and error states", () => {
  const { window, messages } = createHarness(`
    <button data-on:click="roll">Roll</button>
    <p id="pending" data-show="$rollResult.status == 'pending'">Loading</p>
    <p id="success" data-show="$rollResult.status == 'complete'" data-text="$rollResult.value.total"></p>
    <p id="error" data-show="$rollResult.status == 'error'" data-text="$rollResult.error"></p>
  `)

  const pending = window.document.querySelector("#pending")
  const success = window.document.querySelector("#success")
  const error = window.document.querySelector("#error")
  assert.notEqual(pending, null)
  assert.notEqual(success, null)
  assert.notEqual(error, null)

  assert.equal(displayStyle(pending), "none")
  assert.equal(displayStyle(success), "none")

  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(capabilityMessage(messages).target, "rollResult")
  assert.equal(displayStyle(pending), "")
  assert.equal(displayStyle(success), "none")

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "rollResult",
        state: { status: "complete", value: { total: 6 } },
      },
    }),
  )

  assert.equal(displayStyle(pending), "none")
  assert.equal(displayStyle(success), "")
  assert.equal(success?.textContent, "6")
  assert.equal(displayStyle(error), "none")

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "rollResult",
        state: { status: "error", error: "No dice." },
      },
    }),
  )

  assert.equal(displayStyle(success), "none")
  assert.equal(displayStyle(error), "")
  assert.equal(error?.textContent, "No dice.")
})

void test("sandbox runtime refreshes local directives from bound input state", () => {
  const { window } = createHarness(`
    <input data-bind="city" value="red">
    <p id="city" data-text="$city"></p>
    <p id="visible" data-show="$city == 'blue'">Blue</p>
    <p id="classed" data-class:active="$city == 'blue'"></p>
    <p id="styled" data-style:color="$city"></p>
    <p id="attr" data-attr:title="$city"></p>
  `)
  const input = window.document.querySelector("input")
  const city = window.document.querySelector("#city")
  const visible = window.document.querySelector("#visible")
  const classed = window.document.querySelector("#classed")
  const styled = window.document.querySelector("#styled")
  const attr = window.document.querySelector("#attr")
  assert.notEqual(input, null)

  assert.equal(city?.textContent, "red")
  assert.equal(displayStyle(visible), "none")
  assert.equal(classed?.classList.contains("active"), false)
  assert.equal(styled?.getAttribute("style"), "color: red;")
  assert.equal(attr?.getAttribute("title"), "red")

  if (input !== null) input.value = "blue"
  input?.dispatchEvent(new window.Event("input", { bubbles: true }))

  assert.equal(city?.textContent, "blue")
  assert.equal(displayStyle(visible), "")
  assert.equal(classed?.classList.contains("active"), true)
  assert.equal(styled?.getAttribute("style"), "color: blue;")
  assert.equal(attr?.getAttribute("title"), "blue")
})

void test("sandbox runtime brokers link clicks", () => {
  const { window, messages } = createHarness(`
    <a href="https://example.com/path">Open</a>
  `)

  const defaultAllowed = window.document
    .querySelector("a")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(defaultAllowed, false)
  assert.deepEqual(messages, [
    {
      channel: protocolChannel,
      surfaceId: "surface-test",
      type: "link",
      href: "https://example.com/path",
    },
  ])
})

void test("sandbox runtime ignores unsupported actions and disposes listeners", () => {
  const { window, messages, instance } = createHarness(`
    <button id="unsupported" data-on:click="unsupported">Bad</button>
    <button id="roll" data-on:click="roll">Roll</button>
  `)

  const defaultAllowed = window.document
    .querySelector("#unsupported")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))
  instance.dispose()
  window.document
    .querySelector("#roll")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(defaultAllowed, true)
  assert.deepEqual(messages, [])
})
