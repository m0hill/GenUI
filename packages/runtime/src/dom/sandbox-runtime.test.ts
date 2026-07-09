import assert from "node:assert/strict"
import { test } from "node:test"
import type { Window } from "happy-dom"
import { protocolChannel, type SurfaceSnapshot } from "./protocol.js"
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

const createHarness = (
  html: string,
  surfaceId = "surface-test",
  snapshot?: SurfaceSnapshot,
): RuntimeHarness => {
  const { window, messages } = createSandboxWindow(html)

  const instance = installSandboxRuntime(
    { channel: protocolChannel, surfaceId, ...(snapshot === undefined ? {} : { snapshot }) },
    asSandboxGlobal(window),
  )

  return { window, messages, instance }
}

const runtimeExpressionDetails = (messages: readonly unknown[]): readonly string[] =>
  messages.flatMap((message) =>
    isRecord(message) && message.type === "violation" && message.reason === "runtime_expression"
      ? [typeof message.detail === "string" ? message.detail : ""]
      : [],
  )

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

void test("sandbox runtime posts change actions after syncing bound state", () => {
  const { window, messages } = createHarness(`
    <section data-genui-state="{ sort: 'newest' }">
      <select data-genui-bind="sort" data-genui-on-change="@action('orders.search', { sort: $sort }, { target: 'orders' })">
        <option value="newest" selected>Newest</option>
        <option value="oldest">Oldest</option>
      </select>
    </section>
  `)

  const select = window.document.querySelector("select")
  assert.ok(select instanceof window.HTMLSelectElement)

  select.value = "oldest"
  select.dispatchEvent(new window.Event("change", { bubbles: true }))

  const message = capabilityPostMessage(messages)
  assert.equal(message.action, "orders.search")
  assert.equal(message.target, "orders")
  assert.deepEqual(jsonRoundTrip(message.input), { sort: "oldest" })
})

void test("sandbox runtime posts load actions and renders pending/result state", () => {
  const { window, messages } = createHarness(`
    <section data-genui-state="{ status: 'open' }" data-genui-on-load="@action('orders.search', { status: $status }, { target: 'orders' })">
      <p id="pending" data-genui-show="$orders.status == 'pending'">Loading</p>
      <p id="ready" data-genui-show="$orders.status == 'complete'">Ready</p>
      <ul data-genui-each="$orders.value.items" data-genui-as="order">
        <li data-genui-text="$order.id"></li>
      </ul>
    </section>
  `)

  const message = capabilityPostMessage(messages)
  assert.equal(message.action, "orders.search")
  assert.equal(message.target, "orders")
  assert.deepEqual(jsonRoundTrip(message.input), { status: "open" })
  assert.equal(displayStyle(window.document.querySelector("#pending")), "")
  assert.equal(displayStyle(window.document.querySelector("#ready")), "none")

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: { status: "complete", value: { items: [{ id: "order-1" }] } },
      },
    }),
  )

  assert.equal(displayStyle(window.document.querySelector("#pending")), "none")
  assert.equal(displayStyle(window.document.querySelector("#ready")), "")
  assert.equal(window.document.querySelector("li")?.textContent, "order-1")
})

void test("sandbox runtime skips load actions for snapshot-seeded result targets", () => {
  const { window, messages } = createHarness(
    `
      <section data-genui-on-load="@action('orders.search', {}, { target: 'orders' })">
        <p id="ready" data-genui-show="$orders.status == 'complete'">Ready</p>
        <ul data-genui-each="$orders.value.items" data-genui-as="order">
          <li data-genui-text="$order.id"></li>
        </ul>
      </section>
    `,
    "surface-restored",
    {
      state: {
        orders: { status: "complete", value: { items: [{ id: "order-1" }] } },
      },
      rowStates: {},
    },
  )

  assert.equal(
    messages.some((message) => isRecord(message) && message.type === "capability"),
    false,
  )
  assert.equal(displayStyle(window.document.querySelector("#ready")), "")
  assert.equal(window.document.querySelector("li")?.textContent, "order-1")
})

void test("sandbox runtime reruns load actions for pending or error snapshot targets", () => {
  for (const status of ["pending", "error"] as const) {
    const { messages } = createHarness(
      `
        <section data-genui-on-load="@action('orders.search', {}, { target: 'orders' })">
          <p data-genui-show="$orders.status == 'pending'">Loading</p>
        </section>
      `,
      `surface-restored-${status}`,
      {
        state: {
          orders: status === "error" ? { status, error: "Failed" } : { status },
        },
        rowStates: {},
      },
    )

    const message = capabilityPostMessage(messages)
    assert.equal(message.action, "orders.search")
    assert.equal(message.target, "orders")
  }
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

void test("sandbox runtime renders expression v0.6 operators and formatters", () => {
  const { window } = createHarness(`
    <section data-genui-state="{ count: 3, closed: false, amount: 1234.5, ratio: 0.1234, createdAt: '2026-01-02T12:00:00Z' }">
      <p id="visible" data-genui-show="$count >= 3 && !$closed">Visible</p>
      <p id="hidden" data-genui-show="$count < 3 || $closed">Hidden</p>
      <p id="fallback" data-genui-text="$user.name || 'Guest'"></p>
      <p id="ready" data-genui-text="$count && 'Ready'"></p>
      <p id="math" data-genui-text="($count + 1) * 2"></p>
      <p id="concat" data-genui-text="'Count: ' + $count"></p>
      <p id="number" data-genui-text="formatNumber($amount)"></p>
      <p id="currency" data-genui-text="formatCurrency($amount, 'USD')"></p>
      <p id="percent" data-genui-text="formatPercent($ratio)"></p>
      <p id="date" data-genui-text="formatDate($createdAt)"></p>
      <button id="index" data-genui-on-click="@set('orders.0.total', $count + 7)">Set first order</button>
      <p id="indexed" data-genui-text="$orders.0.total"></p>
    </section>
  `)

  assert.equal(displayStyle(window.document.querySelector("#visible")), "")
  assert.equal(displayStyle(window.document.querySelector("#hidden")), "none")
  assert.equal(window.document.querySelector("#fallback")?.textContent, "Guest")
  assert.equal(window.document.querySelector("#ready")?.textContent, "Ready")
  assert.equal(window.document.querySelector("#math")?.textContent, "8")
  assert.equal(window.document.querySelector("#concat")?.textContent, "Count: 3")
  assert.equal(window.document.querySelector("#number")?.textContent, "1,234.5")
  assert.equal(window.document.querySelector("#currency")?.textContent, "$1,234.50")
  assert.equal(window.document.querySelector("#percent")?.textContent, "12.3%")
  assert.equal(window.document.querySelector("#date")?.textContent, "Jan 2, 2026")

  window.document
    .querySelector("#index")
    ?.dispatchEvent(new window.Event("click", { bubbles: true }))
  assert.equal(window.document.querySelector("#indexed")?.textContent, "10")
})

void test("sandbox runtime reports invalid post-mount expression evaluations", () => {
  const { window, messages } = createHarness(`
    <section data-genui-state="{ amount: 12, currency: 'USD', threshold: 10 }">
      <p id="price" data-genui-text="formatCurrency($amount, $currency)"></p>
      <p id="visible" data-genui-show="$amount > $threshold">Visible</p>
      <button id="bad-currency" data-genui-on-click="@set('currency', 'US Dollars')">Bad currency</button>
      <button id="bad-threshold" data-genui-on-click="@set('threshold', 'large')">Bad threshold</button>
    </section>
  `)

  assert.equal(window.document.querySelector("#price")?.textContent, "$12.00")
  assert.equal(displayStyle(window.document.querySelector("#visible")), "")

  window.document
    .querySelector("#bad-currency")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#bad-threshold")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(window.document.querySelector("#price")?.textContent, "")
  assert.equal(displayStyle(window.document.querySelector("#visible")), "none")
  const details = runtimeExpressionDetails(messages)
  assert.equal(
    details.some((detail) => detail.includes("formatCurrency")),
    true,
  )
  assert.equal(
    details.some((detail) => detail.includes("$amount > $threshold")),
    true,
  )
})

void test("sandbox runtime keeps loading-state expressions quiet until data arrives", () => {
  const { window, messages } = createHarness(`
    <section data-genui-on-load="@action('orders.summary', {}, { target: 'orders' })">
      <p id="total" data-genui-text="formatCurrency($orders.value.total, 'USD')"></p>
      <p id="large" data-genui-show="$orders.value.total > 100">Large order</p>
      <ul data-genui-each="$orders.value.items" data-genui-as="order">
        <li data-genui-text="$order.id"></li>
      </ul>
    </section>
  `)

  assert.equal(capabilityPostMessage(messages).action, "orders.summary")
  assert.deepEqual(runtimeExpressionDetails(messages), [])
  assert.equal(window.document.querySelector("#total")?.textContent, "")
  assert.equal(displayStyle(window.document.querySelector("#large")), "none")
  assert.equal(window.document.querySelector("li"), null)

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "orders",
        state: { status: "complete", value: { total: 120, items: [{ id: "order-1" }] } },
      },
    }),
  )

  assert.equal(window.document.querySelector("#total")?.textContent, "$120.00")
  assert.equal(displayStyle(window.document.querySelector("#large")), "")
  assert.equal(window.document.querySelector("li")?.textContent, "order-1")
  assert.deepEqual(runtimeExpressionDetails(messages), [])
})

void test("sandbox runtime reports invalid repeated-template expressions", () => {
  const invalidEach = createHarness(`
    <ul data-genui-each="formatNumber('bad')" data-genui-as="item">
      <li data-genui-text="$item"></li>
    </ul>
  `)
  assert.equal(
    runtimeExpressionDetails(invalidEach.messages).some((detail) =>
      detail.includes("data-genui-each"),
    ),
    true,
  )

  const invalidKey = createHarness(
    `
      <ul data-genui-each="$items" data-genui-as="item" data-genui-key="formatNumber($item.rank)">
        <li data-genui-text="$item.id"></li>
      </ul>
    `,
    "surface-test",
    {
      state: { items: [{ id: "order-1", rank: "bad" }] },
      rowStates: {},
    },
  )
  assert.equal(invalidKey.window.document.querySelector("li")?.textContent, "order-1")
  assert.equal(
    runtimeExpressionDetails(invalidKey.messages).some((detail) =>
      detail.includes("data-genui-key"),
    ),
    true,
  )
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

void test("sandbox runtime removes stale properties from dynamic style maps", () => {
  const { window } = createHarness(`
    <p id="styled" data-genui-style="$theme.value.styles"></p>
  `)

  const setStyles = (styles: Readonly<Record<string, string>>): void => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: {
          channel: protocolChannel,
          surfaceId: "surface-test",
          type: "result",
          target: "theme",
          state: { status: "complete", value: { styles } },
        },
      }),
    )
  }

  const styled = window.document.querySelector("#styled")
  assert.notEqual(styled, null)

  setStyles({ color: "red" })
  assert.equal(styled?.getAttribute("style"), "color: red;")

  setStyles({})
  assert.equal(styled?.getAttribute("style") ?? "", "")
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

void test("sandbox runtime syncs state changes back into bound form controls", () => {
  const { window } = createHarness(`
    <section data-genui-state="{ query: 'Acme', enabled: true, status: 'open', note: 'Ready', choice: 'b' }">
      <input id="query" data-genui-bind="query">
      <input id="enabled" type="checkbox" data-genui-bind="enabled">
      <input id="choice-a" type="radio" name="choice" value="a" data-genui-bind="choice">
      <input id="choice-b" type="radio" name="choice" value="b" data-genui-bind="choice">
      <select id="status" data-genui-bind="status">
        <option value="open">Open</option>
        <option value="closed">Closed</option>
      </select>
      <textarea id="note" data-genui-bind="note"></textarea>
      <button id="clear" data-genui-on-click="@set('query', '')">Clear</button>
      <button id="disable" data-genui-on-click="@set('enabled', false)">Disable</button>
      <button id="choose-a" data-genui-on-click="@set('choice', 'a')">Choose A</button>
      <button id="close" data-genui-on-click="@set('status', 'closed')">Close</button>
      <button id="blank" data-genui-on-click="@set('note', '')">Blank</button>
    </section>
  `)

  const query = window.document.querySelector("#query")
  const enabled = window.document.querySelector("#enabled")
  const choiceA = window.document.querySelector("#choice-a")
  const choiceB = window.document.querySelector("#choice-b")
  const status = window.document.querySelector("#status")
  const note = window.document.querySelector("#note")
  assert.ok(query instanceof window.HTMLInputElement)
  assert.ok(enabled instanceof window.HTMLInputElement)
  assert.ok(choiceA instanceof window.HTMLInputElement)
  assert.ok(choiceB instanceof window.HTMLInputElement)
  assert.ok(status instanceof window.HTMLSelectElement)
  assert.ok(note instanceof window.HTMLTextAreaElement)

  assert.equal(query?.value, "Acme")
  assert.equal(enabled?.checked, true)
  assert.equal(choiceA?.checked, false)
  assert.equal(choiceB?.checked, true)
  assert.equal(status?.value, "open")
  assert.equal(note?.value, "Ready")

  window.document
    .querySelector("#clear")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#disable")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#choose-a")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#close")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  window.document
    .querySelector("#blank")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(query?.value, "")
  assert.equal(enabled?.checked, false)
  assert.equal(choiceA?.checked, true)
  assert.equal(choiceB?.checked, false)
  assert.equal(status?.value, "closed")
  assert.equal(note?.value, "")
})

void test("sandbox runtime does not resync the source control during input refresh", () => {
  const { window } = createHarness(`
    <input id="quantity" type="number" data-genui-bind="quantity" value="1">
    <p id="state" data-genui-text="$quantity"></p>
  `)

  const quantity = window.document.querySelector("#quantity")
  const stateText = window.document.querySelector("#state")
  assert.ok(quantity instanceof window.HTMLInputElement)

  quantity.value = "01"
  quantity.focus()
  quantity.dispatchEvent(new window.Event("input", { bubbles: true }))

  assert.equal(quantity.value, "01")
  assert.equal(stateText?.textContent, "1")
})

void test("sandbox runtime syncs focused controls after authored actions", () => {
  const { window } = createHarness(`
    <form data-genui-on-submit="@set('query', '')">
      <input id="query" data-genui-bind="query" value="initial">
      <p id="state" data-genui-text="$query"></p>
    </form>
  `)

  const query = window.document.querySelector("#query")
  const form = window.document.querySelector("form")
  const stateText = window.document.querySelector("#state")
  assert.ok(query instanceof window.HTMLInputElement)

  query.focus()
  query.value = "draft"
  query.dispatchEvent(new window.Event("input", { bubbles: true }))
  assert.equal(query.value, "draft")
  assert.equal(stateText?.textContent, "draft")

  const defaultAllowed = form?.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  )

  assert.equal(defaultAllowed, false)
  assert.equal(query.value, "")
  assert.equal(stateText?.textContent, "")
})

void test("sandbox runtime syncs focused controls after result messages", () => {
  const { window } = createHarness(`
    <input id="query" data-genui-bind="query" value="initial">
    <p id="state" data-genui-text="$query"></p>
  `)

  const query = window.document.querySelector("#query")
  const stateText = window.document.querySelector("#state")
  assert.ok(query instanceof window.HTMLInputElement)

  query.focus()
  query.value = "draft"

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "result",
        target: "query",
        state: "server",
      },
    }),
  )

  assert.equal(query.value, "server")
  assert.equal(stateText?.textContent, "server")
})

void test("sandbox runtime keeps prototype-shaped state paths as own data", () => {
  const pollutionKey = "genuiPolluted"
  Reflect.deleteProperty(Object.prototype, pollutionKey)

  try {
    const { window, messages } = createHarness(`
      <section>
        <button id="bad" data-genui-on-click="@set('__proto__.${pollutionKey}', 'bad')">Bad</button>
        <button id="constructor" data-genui-on-click="@set('constructor.prototype.${pollutionKey}', 'owned')">
          Constructor
        </button>
        <button id="prototype" data-genui-on-click="@set('prototype.${pollutionKey}', 'owned')">
          Prototype
        </button>
        <button id="send" data-genui-on-click="@action('state.inspect', { constructorValue: $constructor.prototype.${pollutionKey}, prototypeValue: $prototype.${pollutionKey}, missingConstructor: $missing.constructor }, { target: 'inspect' })">
          Send
        </button>
      </section>
    `)

    window.document
      .querySelector("#bad")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey), undefined)

    window.document
      .querySelector("#constructor")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    window.document
      .querySelector("#prototype")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey), undefined)

    window.document
      .querySelector("#send")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

    const message = capabilityPostMessage(messages)
    assert.equal(message.action, "state.inspect")
    assert.deepEqual(jsonRoundTrip(message.input), {
      constructorValue: "owned",
      prototypeValue: "owned",
      missingConstructor: "",
    })
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey), undefined)
  } finally {
    Reflect.deleteProperty(Object.prototype, pollutionKey)
  }
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

void test("sandbox runtime preserves keyed repeated rows across reorder", () => {
  const { window } = createHarness(`
    <ul data-genui-each="$orders.value.items" data-genui-as="order" data-genui-key="$order.id">
      <li class="row" data-genui-class="$order.status" data-genui-style="$order.styles">
        <span class="id" data-genui-text="$order.id"></span>
        <span class="status" data-genui-text="$order.status"></span>
        <input class="draft" value="">
      </li>
    </ul>
  `)

  const setOrders = (items: readonly Record<string, unknown>[]): void => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: {
          channel: protocolChannel,
          surfaceId: "surface-test",
          type: "result",
          target: "orders",
          state: { status: "complete", value: { items } },
        },
      }),
    )
  }

  setOrders([
    { id: "order-1", status: "paid", styles: {} },
    { id: "order-2", status: "pending", styles: { color: "red" } },
  ])

  const firstRows = Array.from(window.document.querySelectorAll("li"))
  assert.equal(firstRows.length, 2)
  const keptRow = firstRows[1]
  assert.notEqual(keptRow, undefined)
  const keptInput = keptRow?.querySelector("input")
  assert.notEqual(keptInput, null)
  if (keptInput !== null) keptInput.value = "draft survives"

  setOrders([
    { id: "order-2", status: "refunded", styles: {} },
    { id: "order-1", status: "paid", styles: {} },
  ])

  const nextRows = Array.from(window.document.querySelectorAll("li"))
  assert.equal(nextRows.length, 2)
  assert.equal(nextRows[0], keptRow)
  assert.equal(nextRows[0]?.querySelector(".id")?.textContent, "order-2")
  assert.equal(nextRows[0]?.querySelector(".status")?.textContent, "refunded")
  assert.equal(nextRows[0]?.className, "row refunded")
  assert.equal(nextRows[0]?.getAttribute("style") ?? "", "")
  assert.equal(nextRows[0]?.querySelector("input")?.value, "draft survives")
})

void test("sandbox runtime keeps row-local bindings scoped to keyed rows", () => {
  const { window, messages } = createHarness(`
    <ul data-genui-each="$orders.value.items" data-genui-as="order" data-genui-key="$order.id">
      <li data-genui-row-state="{ note: $order.note, editing: false }">
        <span class="id" data-genui-text="$order.id"></span>
        <input class="note" data-genui-bind="row.note">
        <button class="edit" data-genui-on-click="@set('row.editing', true)">Edit</button>
        <span class="editing" data-genui-text="$row.editing"></span>
        <button class="save" data-genui-on-click="@action('orders.update', { id: $order.id, note: $row.note, editing: $row.editing }, { target: 'orders' })">
          Save
        </button>
      </li>
    </ul>
  `)

  const setOrders = (items: readonly Record<string, string>[]): void => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: {
          channel: protocolChannel,
          surfaceId: "surface-test",
          type: "result",
          target: "orders",
          state: { status: "complete", value: { items } },
        },
      }),
    )
  }

  setOrders([
    { id: "order-1", note: "Alpha" },
    { id: "order-2", note: "Beta" },
  ])

  const firstRows = Array.from(window.document.querySelectorAll("li"))
  const order2Row = firstRows[1]
  const order2Note = order2Row?.querySelector("input")
  assert.ok(order2Note instanceof window.HTMLInputElement)
  assert.equal(order2Note.value, "Beta")

  order2Note.value = "Draft beta"
  order2Note.dispatchEvent(new window.Event("input", { bubbles: true }))
  order2Row
    ?.querySelector(".edit")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(order2Note.value, "Draft beta")
  assert.equal(order2Row?.querySelector(".editing")?.textContent, "true")

  setOrders([
    { id: "order-2", note: "Server beta" },
    { id: "order-1", note: "Alpha" },
  ])

  const nextRows = Array.from(window.document.querySelectorAll("li"))
  assert.equal(nextRows[0], order2Row)
  assert.equal(nextRows[0]?.querySelector(".id")?.textContent, "order-2")
  assert.equal(nextRows[0]?.querySelector("input")?.value, "Draft beta")
  assert.equal(nextRows[0]?.querySelector(".editing")?.textContent, "true")

  nextRows[0]
    ?.querySelector(".save")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  const message = capabilityPostMessage(messages)
  assert.equal(message.action, "orders.update")
  assert.deepEqual(jsonRoundTrip(message.input), {
    editing: true,
    id: "order-2",
    note: "Draft beta",
  })

  setOrders([{ id: "order-1", note: "Alpha" }])
  assert.equal(window.document.querySelectorAll("li").length, 1)

  setOrders([
    { id: "order-2", note: "Fresh beta" },
    { id: "order-1", note: "Alpha" },
  ])
  const restoredOrder2Note = window.document.querySelector("li input")
  assert.ok(restoredOrder2Note instanceof window.HTMLInputElement)
  assert.equal(restoredOrder2Note.value, "Fresh beta")
})

void test("sandbox runtime snapshots and restores global and row state", () => {
  const html = `
    <section data-genui-state="{ filter: 'open' }">
      <select id="filter" data-genui-bind="filter">
        <option value="open" selected>Open</option>
        <option value="closed">Closed</option>
      </select>
      <ul data-genui-each="$orders.value.items" data-genui-as="order" data-genui-key="$order.id">
        <li data-genui-row-state="{ note: $order.note }">
          <span class="id" data-genui-text="$order.id"></span>
          <input class="note" data-genui-bind="row.note" value="">
        </li>
      </ul>
    </section>
  `
  const { window, messages } = createHarness(html)
  const setOrders = (items: readonly Record<string, string>[]): void => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: {
          channel: protocolChannel,
          surfaceId: "surface-test",
          type: "result",
          target: "orders",
          state: { status: "complete", value: { items } },
        },
      }),
    )
  }

  setOrders([
    { id: "order-1", note: "Alpha" },
    { id: "order-2", note: "Beta" },
  ])

  const filter = window.document.querySelector("#filter")
  const order2Note = window.document.querySelectorAll(".note")[1]
  assert.ok(filter instanceof window.HTMLSelectElement)
  assert.ok(order2Note instanceof window.HTMLInputElement)

  filter.value = "closed"
  filter.dispatchEvent(new window.Event("change", { bubbles: true }))
  order2Note.value = "Draft beta"
  order2Note.dispatchEvent(new window.Event("input", { bubbles: true }))

  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        channel: protocolChannel,
        surfaceId: "surface-test",
        type: "snapshot_request",
        requestId: "request-1",
      },
    }),
  )

  const snapshotMessage = messages.find(
    (message) => isRecord(message) && message.type === "snapshot",
  )
  assert.ok(isRecord(snapshotMessage))
  assert.ok(isRecord(snapshotMessage.snapshot))
  const snapshot = snapshotMessage.snapshot as unknown as SurfaceSnapshot

  assert.equal(snapshotMessage.requestId, "request-1")
  assert.equal(snapshot.state.filter, "closed")
  assert.equal(
    isRecord(snapshot.state.orders) && isRecord(snapshot.state.orders.value)
      ? Array.isArray(snapshot.state.orders.value.items)
      : false,
    true,
  )
  const rowSnapshots = Object.values(snapshot.rowStates).flatMap((rows) => Object.values(rows))
  assert.equal(
    rowSnapshots.some((row) => row.note === "Alpha"),
    true,
  )
  assert.equal(
    rowSnapshots.some((row) => row.note === "Draft beta"),
    true,
  )

  const restored = createHarness(html, "surface-restored", snapshot)
  const restoredFilter = restored.window.document.querySelector("#filter")
  const restoredRows = Array.from(restored.window.document.querySelectorAll("li"))
  const restoredOrder2Note = restoredRows[1]?.querySelector(".note")

  assert.ok(restoredFilter instanceof restored.window.HTMLSelectElement)
  assert.ok(restoredOrder2Note instanceof restored.window.HTMLInputElement)
  assert.equal(restoredFilter.value, "closed")
  assert.equal(restoredRows.length, 2)
  assert.equal(restoredRows[1]?.querySelector(".id")?.textContent, "order-2")
  assert.equal(restoredOrder2Note.value, "Draft beta")
})

void test("sandbox runtime reserves row outside row scope", () => {
  const { window } = createHarness(`
    <input data-genui-bind="row.note" value="Ignored">
    <button data-genui-on-click="@set('row.editing', true)">Edit</button>
    <span class="editing" data-genui-text="$row.editing"></span>
  `)

  assert.equal(window.document.querySelector("input")?.getAttribute("value"), "Ignored")
  assert.equal(window.document.querySelector(".editing")?.textContent, "")

  window.document
    .querySelector("button")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(window.document.querySelector(".editing")?.textContent, "")
})

void test("sandbox runtime does not leak row state during duplicate-key fallback", () => {
  const { window } = createHarness(`
    <ul data-genui-each="$orders.value.items" data-genui-as="order" data-genui-key="$order.id">
      <li data-genui-row-state="{ editing: false }">
        <span class="id" data-genui-text="$order.name"></span>
        <button class="edit" data-genui-on-click="@set('row.editing', true)">Edit</button>
        <span class="editing" data-genui-text="$row.editing"></span>
      </li>
    </ul>
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
              { id: "duplicate", name: "First" },
              { id: "duplicate", name: "Second" },
            ],
          },
        },
      },
    }),
  )

  const rows = Array.from(window.document.querySelectorAll("li"))
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((row) => row.querySelector(".editing")?.textContent),
    ["", ""],
  )

  rows[0]
    ?.querySelector(".edit")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.deepEqual(
    Array.from(window.document.querySelectorAll("li")).map(
      (row) => row.querySelector(".editing")?.textContent,
    ),
    ["", ""],
  )
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
