import assert from "node:assert/strict"
import { test } from "node:test"
import { protocolChannel } from "./protocol.js"
import { sandboxBridgeScript } from "./sandbox-bridge.js"
import {
  capabilityPostMessage,
  createSandboxWindow,
  displayStyle,
  isRecord,
  jsonRoundTrip,
} from "./test-support.test-support.js"

type BridgeHarness = ReturnType<typeof createSandboxWindow>

const createHarness = (html: string, surfaceId = "surface-test"): BridgeHarness => {
  const { window, messages } = createSandboxWindow(html)
  window.eval(sandboxBridgeScript(surfaceId))

  return { window, messages }
}

void test("sandbox bridge evaluates the bundled runtime asset", () => {
  const script = sandboxBridgeScript("surface-test")
  assert.doesNotMatch(script, /\.toString\(/)
  assert.doesNotMatch(script, /genui0SandboxLanguageScript/)
  assert.doesNotMatch(script, /cssStylePolicyScript/)

  const { window } = createHarness(`<p id="ready">Ready</p>`)

  assert.equal(window.document.querySelector("#ready")?.textContent, "Ready")
})

void test("sandbox bridge posts capability calls from click actions", () => {
  const { window, messages } = createHarness(`
    <div data-genui-state="{ label: 'Fallback' }">
      <input data-genui-bind="label" value="Lucky">
      <input data-genui-bind="sides" type="number" value="6">
      <button data-genui-on-click="@capability('dice.roll', { sides: $sides, label: $label, lucky: true, note: 'ok' }, { target: 'rollResult' })">
        Roll
      </button>
    </div>
  `)

  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  const message = capabilityPostMessage(messages)
  assert.equal(message.channel, protocolChannel)
  assert.equal(message.surfaceId, "surface-test")
  assert.equal(message.capability, "dice.roll")
  assert.equal(typeof message.callId, "string")
  assert.equal(message.target, "rollResult")
  assert.deepEqual(jsonRoundTrip(message.input), {
    sides: 6,
    label: "Lucky",
    lucky: true,
    note: "ok",
  })
})

void test("sandbox bridge posts capability calls from submit actions", () => {
  const { window, messages } = createHarness(`
    <form data-genui-on-submit="@capability('weather.lookup', { city: $city })">
      <input data-genui-bind="city" value="Tokyo">
      <button>Search</button>
    </form>
  `)
  const form = window.document.querySelector("form")
  assert.notEqual(form, null)

  const defaultAllowed = form?.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  )

  assert.equal(defaultAllowed, false)
  const message = capabilityPostMessage(messages)
  assert.equal(message.capability, "weather.lookup")
  assert.deepEqual(jsonRoundTrip(message.input), { city: "Tokyo" })
  assert.equal(message.target, undefined)
})

void test("sandbox bridge runs local set actions without posting messages", () => {
  const { window, messages } = createHarness(`
    <section data-genui-state="{ tab: 'summary' }">
      <button id="details" data-genui-on-click="@set('tab', 'details')">Details</button>
      <p id="summary-panel" data-genui-show="$tab == 'summary'">Summary panel</p>
      <p id="details-panel" data-genui-show="$tab == 'details'">Details panel</p>
      <p id="current" data-genui-text="$tab"></p>
    </section>
  `)

  const summaryPanel = window.document.querySelector("#summary-panel")
  const detailsPanel = window.document.querySelector("#details-panel")
  const current = window.document.querySelector("#current")

  assert.equal(displayStyle(summaryPanel), "")
  assert.equal(displayStyle(detailsPanel), "none")
  assert.equal(current?.textContent, "summary")

  window.document
    .querySelector("#details")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(displayStyle(summaryPanel), "none")
  assert.equal(displayStyle(detailsPanel), "")
  assert.equal(current?.textContent, "details")
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability"),
    false,
  )
})

void test("sandbox bridge exposes result state to later capability inputs", () => {
  const { window, messages } = createHarness(`
    <button data-genui-on-click="@capability('notes.create', { total: $rollResult.value.total })">
      Save
    </button>
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

  const message = capabilityPostMessage(messages)
  assert.equal(message.capability, "notes.create")
  assert.deepEqual(jsonRoundTrip(message.input), { total: 6 })
})

void test("sandbox bridge renders pending and result state directives", () => {
  const { window, messages } = createHarness(`
    <button data-genui-on-click="@capability('dice.roll', { sides: 6 }, { target: 'rollResult' })">
      Roll
    </button>
    <p id="pending" data-genui-show="$rollResult.status == 'pending'">Loading</p>
    <p id="success" data-genui-show="$rollResult.status == 'complete'" data-genui-text="$rollResult.value.total"></p>
  `)
  const pending = window.document.querySelector("#pending")
  const success = window.document.querySelector("#success")

  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(capabilityPostMessage(messages).target, "rollResult")
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
})

void test("sandbox bridge rejects unsupported capability expressions", () => {
  const { window, messages } = createHarness(`
    <input data-genui-bind="target" value="rollResult">
    <button id="bad-input" data-genui-on-click="@capability('dice.roll', { sides: window.location })">Bad</button>
    <button id="bad-target" data-genui-on-click="@capability('dice.roll', { sides: 6 }, { target: $target })">Bad target</button>
  `)

  window.document
    .querySelector("#bad-input")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#bad-target")
    ?.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }))

  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability"),
    false,
  )
})
