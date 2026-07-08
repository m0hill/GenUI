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

const language: SandboxRuntimeLanguage = {
  invalid,
  parseObjectLiteral(source) {
    return source.includes("label") ? { label: "Fallback" } : {}
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
