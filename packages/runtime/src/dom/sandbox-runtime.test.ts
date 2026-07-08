import assert from "node:assert/strict"
import { test } from "node:test"
import type { Window } from "happy-dom"
import { protocolChannel } from "./protocol.js"
import {
  installSandboxRuntime,
  type SandboxRuntimeGlobal,
  type SandboxRuntimeInstance,
} from "./sandbox-runtime.js"
import {
  capabilityPostMessage,
  createSandboxWindow,
  displayStyle,
  isRecord,
  jsonRoundTrip,
} from "./test-support.test-support.js"

interface RuntimeHarness {
  readonly window: Window
  readonly messages: unknown[]
  readonly instance: SandboxRuntimeInstance
}

const asSandboxGlobal = (window: Window): SandboxRuntimeGlobal => {
  // SAFETY: happy-dom's Window exposes the browser APIs used by the sandbox runtime. Its
  // TypeScript classes are separate from lib.dom classes even though the runtime API matches here.
  return window as unknown as SandboxRuntimeGlobal
}

const createHarness = (html: string, surfaceId = "surface-test"): RuntimeHarness => {
  const { window, messages } = createSandboxWindow(html)

  const instance = installSandboxRuntime(
    { channel: protocolChannel, surfaceId },
    asSandboxGlobal(window),
  )

  return { window, messages, instance }
}

void test("sandbox runtime posts capability calls from click actions", () => {
  const { window, messages } = createHarness(`
    <div data-genui-state="{ label: 'Fallback' }">
      <input data-genui-bind="label" value="Lucky">
      <input data-genui-bind="sides" type="number" value="6">
      <button data-genui-on-click="@capability('dice.roll', { label: $label, sides: $sides, missing: $missing }, { target: 'rollResult' })">
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
  assert.equal(message.action, "dice.roll")
  assert.equal(typeof message.callId, "string")
  assert.equal(message.target, "rollResult")
  assert.deepEqual(jsonRoundTrip(message.input), {
    label: "Lucky",
    sides: 6,
    missing: "",
  })
})

void test("sandbox runtime posts capability calls from submit actions", () => {
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
  assert.equal(message.action, "weather.lookup")
  assert.deepEqual(jsonRoundTrip(message.input), { city: "Tokyo" })
  assert.equal(message.target, undefined)
})

void test("sandbox runtime exposes result state to later capability inputs", () => {
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
  assert.equal(message.action, "notes.create")
  assert.deepEqual(jsonRoundTrip(message.input), { total: 6 })
})

void test("sandbox runtime renders capability pending, success, and error states", () => {
  const { window, messages } = createHarness(`
    <button data-genui-on-click="@capability('dice.roll', { sides: 6 }, { target: 'rollResult' })">
      Roll
    </button>
    <p id="pending" data-genui-show="$rollResult.status == 'pending'">Loading</p>
    <p id="success" data-genui-show="$rollResult.status == 'complete'" data-genui-text="$rollResult.value.total"></p>
    <p id="error" data-genui-show="$rollResult.status == 'error'" data-genui-text="$rollResult.error"></p>
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
    <input data-genui-bind="city" value="red">
    <p id="city" data-genui-text="$city"></p>
    <p id="visible" data-genui-show="$city == 'blue'">Blue</p>
    <p id="classed" data-genui-class-active="$city == 'blue'"></p>
    <p id="classed-hyphen" data-genui-class-is-active="$city == 'blue'"></p>
    <p id="styled" data-genui-style-color="$city"></p>
    <p id="styled-hyphen" data-genui-style-background-color="$city"></p>
    <p id="styled-legacy" data-genui-style-property-background="$city"></p>
    <p id="attr" data-genui-attr-title="$city"></p>
    <p id="attr-hyphen" data-genui-attr-aria-label="$city"></p>
  `)
  const input = window.document.querySelector("input")
  const city = window.document.querySelector("#city")
  const visible = window.document.querySelector("#visible")
  const classed = window.document.querySelector("#classed")
  const classedHyphen = window.document.querySelector("#classed-hyphen")
  const styled = window.document.querySelector("#styled")
  const styledHyphen = window.document.querySelector("#styled-hyphen")
  const styledLegacy = window.document.querySelector("#styled-legacy")
  const attr = window.document.querySelector("#attr")
  const attrHyphen = window.document.querySelector("#attr-hyphen")
  assert.notEqual(input, null)

  assert.equal(city?.textContent, "red")
  assert.equal(displayStyle(visible), "none")
  assert.equal(classed?.classList.contains("active"), false)
  assert.equal(classedHyphen?.classList.contains("is-active"), false)
  assert.equal(styled?.getAttribute("style"), "color: red;")
  assert.equal(styledHyphen?.getAttribute("style"), "background-color: red;")
  assert.equal(styledLegacy?.getAttribute("style"), "background: red;")
  assert.equal(attr?.getAttribute("title"), "red")
  assert.equal(attrHyphen?.getAttribute("aria-label"), "red")

  if (input !== null) input.value = "blue"
  input?.dispatchEvent(new window.Event("input", { bubbles: true }))

  assert.equal(city?.textContent, "blue")
  assert.equal(displayStyle(visible), "")
  assert.equal(classed?.classList.contains("active"), true)
  assert.equal(classedHyphen?.classList.contains("is-active"), true)
  assert.equal(styled?.getAttribute("style"), "color: blue;")
  assert.equal(styledHyphen?.getAttribute("style"), "background-color: blue;")
  assert.equal(styledLegacy?.getAttribute("style"), "background: blue;")
  assert.equal(attr?.getAttribute("title"), "blue")
  assert.equal(attrHyphen?.getAttribute("aria-label"), "blue")
})

void test("sandbox runtime removes unsafe dynamic style values", () => {
  const { window } = createHarness(`
    <input data-genui-bind="background" value="linear-gradient(135deg,#fff,#f8fafc)">
    <p id="styled" data-genui-style-background="$background"></p>
  `)
  const input = window.document.querySelector("input")
  const styled = window.document.querySelector("#styled")
  assert.notEqual(input, null)

  assert.match(styled?.getAttribute("style") ?? "", /linear-gradient/)

  if (input !== null) input.value = "url(https://example.com/track.png)"
  input?.dispatchEvent(new window.Event("input", { bubbles: true }))

  assert.doesNotMatch(styled?.getAttribute("style") ?? "", /url\(/)
  assert.doesNotMatch(styled?.getAttribute("style") ?? "", /background/)
})

void test("sandbox runtime runs local set actions without posting messages", () => {
  const { window, messages } = createHarness(`
    <section data-genui-state="{ tab: 'summary' }">
      <button id="summary" data-genui-on-click="@set('tab', 'summary')">Summary</button>
      <button id="details" data-genui-on-click="@set('tab', 'details')">Details</button>
      <p id="summary-panel" data-genui-show="$tab == 'summary'">Summary panel</p>
      <p id="details-panel" data-genui-show="$tab == 'details'">Details panel</p>
      <p id="current" data-genui-text="$tab"></p>
    </section>
  `)

  const details = window.document.querySelector("#details")
  const summaryPanel = window.document.querySelector("#summary-panel")
  const detailsPanel = window.document.querySelector("#details-panel")
  const current = window.document.querySelector("#current")

  assert.equal(displayStyle(summaryPanel), "")
  assert.equal(displayStyle(detailsPanel), "none")
  assert.equal(current?.textContent, "summary")

  details?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(displayStyle(summaryPanel), "none")
  assert.equal(displayStyle(detailsPanel), "")
  assert.equal(current?.textContent, "details")
  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability"),
    false,
  )
})

void test("sandbox runtime does not install bindings from repeated templates", () => {
  const { window } = createHarness(`
    <input data-genui-bind="outside" value="kept">
    <section data-genui-each="$orders.value.items" data-genui-as="order">
      <input data-genui-bind="inside" value="should-not-bind">
      <span data-genui-text="$inside"></span>
    </section>
    <p id="outside" data-genui-text="$outside"></p>
    <p id="inside" data-genui-text="$inside"></p>
  `)

  assert.equal(window.document.querySelector("#outside")?.textContent, "kept")
  assert.equal(window.document.querySelector("#inside")?.textContent, "")
})

void test("sandbox runtime renders repeated items with scoped capability inputs", () => {
  const { window, messages } = createHarness(`
    <p id="empty" data-genui-show="$orders.value.items.length == 0">No orders</p>
    <p id="updating" data-genui-show="$orders.status == 'pending'">Updating</p>
    <table>
      <tbody data-genui-each="$orders.value.items" data-genui-as="order">
        <tr>
          <td data-genui-text="$order.id"></td>
          <td data-genui-text="$order.status"></td>
          <td>
            <button data-genui-on-click="@capability('orders.refund', { id: $order.id }, { target: 'orders' })">
              Refund
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  `)

  assert.equal(window.document.querySelectorAll("tbody tr").length, 0)

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: {
          status: "complete",
          value: {
            items: [
              { id: "order-1", status: "paid" },
              { id: "order-2", status: "pending" },
            ],
          },
        },
      },
    }),
  )

  assert.equal(displayStyle(window.document.querySelector("#empty")), "none")
  const rows = Array.from(window.document.querySelectorAll("tbody tr"))
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.textContent?.includes("order-1"), true)
  assert.equal(rows[0]?.textContent?.includes("paid"), true)
  assert.equal(rows[1]?.textContent?.includes("order-2"), true)
  assert.equal(rows[1]?.textContent?.includes("pending"), true)

  rows[1]
    ?.querySelector("button")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(window.document.querySelectorAll("tbody tr").length, 2)
  assert.equal(
    window.document.querySelectorAll("tbody tr")[1]?.textContent?.includes("order-2"),
    true,
  )
  assert.equal(displayStyle(window.document.querySelector("#updating")), "")

  const message = capabilityPostMessage(messages)
  assert.equal(message.action, "orders.refund")
  assert.equal(message.target, "orders")
  assert.deepEqual(jsonRoundTrip(message.input), { id: "order-2" })

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: {
          status: "complete",
          value: { items: [] },
        },
      },
    }),
  )

  assert.equal(window.document.querySelectorAll("tbody tr").length, 0)
  assert.equal(displayStyle(window.document.querySelector("#empty")), "")
})

void test("sandbox runtime renders nested repeated items with merged scopes", () => {
  const { window, messages } = createHarness(`
    <section data-genui-each="$orders.value.items" data-genui-as="order">
      <article>
        <h2 data-genui-text="$order.id"></h2>
        <ul data-genui-each="$order.lines" data-genui-as="line">
          <li>
            <span class="line-id" data-genui-text="$line.id"></span>
            <span class="line-sku" data-genui-text="$line.sku"></span>
            <button data-genui-on-click="@capability('orders.adjust_line', { orderId: $order.id, lineId: $line.id }, { target: 'orders' })">
              Adjust
            </button>
          </li>
        </ul>
      </article>
    </section>
  `)

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: {
          status: "complete",
          value: {
            items: [
              {
                id: "order-1",
                lines: [
                  { id: "line-1", sku: "A" },
                  { id: "line-2", sku: "B" },
                ],
              },
              { id: "order-2", lines: [{ id: "line-3", sku: "C" }] },
            ],
          },
        },
      },
    }),
  )

  assert.equal(window.document.querySelectorAll("article").length, 2)
  assert.equal(window.document.querySelectorAll("li").length, 3)
  assert.equal(window.document.querySelectorAll(".line-id")[2]?.textContent, "line-3")
  assert.equal(window.document.querySelectorAll(".line-sku")[2]?.textContent, "C")

  window.document
    .querySelectorAll("button")[2]
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  const message = capabilityPostMessage(messages)
  assert.equal(message.action, "orders.adjust_line")
  assert.equal(message.target, "orders")
  assert.deepEqual(jsonRoundTrip(message.input), { lineId: "line-3", orderId: "order-2" })

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: {
          status: "complete",
          value: {
            items: [{ id: "order-3", lines: [{ id: "line-4", sku: "D" }] }],
          },
        },
      },
    }),
  )

  assert.equal(window.document.querySelectorAll("article").length, 1)
  assert.equal(window.document.querySelectorAll("li").length, 1)
  assert.equal(window.document.querySelector(".line-id")?.textContent, "line-4")
  assert.equal(window.document.querySelector("h2")?.textContent, "order-3")
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
    <button id="unsupported" data-genui-on-click="unsupported">Bad</button>
    <button id="roll" data-genui-on-click="@capability('dice.roll', { sides: 6 })">Roll</button>
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
