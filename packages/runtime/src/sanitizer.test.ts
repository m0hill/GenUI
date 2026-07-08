import assert from "node:assert/strict"
import { test } from "node:test"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import type { Action } from "./types.js"

const granted: readonly Action[] = [
  {
    name: "dice.roll",
    description: "Roll a die.",
    effect: "read",
    requiresApproval: false,
  },
  {
    name: "notes.create",
    description: "Create a note.",
    effect: "write",
    requiresApproval: false,
  },
]
const sanitize = (html: string): string => sanitizeSurfaceHtml(html, granted).html

void test("sanitizer strips dangerous tags, event handlers, and URL schemes", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<div onclick="evil()">`,
      `<script>alert(1)</script>`,
      `<iframe src="https://example.com/embed"></iframe>`,
      `<a href="javascript:alert(1)">bad</a>`,
      `<img src="data:text/html,evil" onerror="evil()">`,
      `<img src="https://example.com/image.png">`,
      `</div>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.doesNotMatch(safe, /<script/i)
  assert.doesNotMatch(safe, /<iframe/i)
  assert.doesNotMatch(safe, /onclick/i)
  assert.doesNotMatch(safe, /onerror/i)
  assert.doesNotMatch(safe, /javascript:/i)
  assert.doesNotMatch(safe, /data:text/i)
  assert.match(safe, /src="https:\/\/example\.com\/image\.png"/)
  assert.deepEqual(sanitized.dropped, [
    { node: "div", attribute: "onclick", value: "evil()", reason: "event_handler" },
    { node: "script", reason: "forbidden_element" },
    { node: "iframe", reason: "forbidden_element" },
    { node: "a", attribute: "href", value: "javascript:alert(1)", reason: "unsafe_url" },
    { node: "img", attribute: "src", value: "data:text/html,evil", reason: "unsafe_url" },
    { node: "img", attribute: "onerror", value: "evil()", reason: "event_handler" },
  ])
})

void test("sanitizer strips direct form submission attributes", () => {
  const safe = sanitize(
    [
      `<form action="https://example.com/post" method="post" target="_top">`,
      `<button formaction="https://example.com/override">Submit</button>`,
      `<a href="https://example.com" target="_top" download ping="https://example.com/ping">Open</a>`,
      `</form>`,
    ].join(""),
  )

  assert.doesNotMatch(safe, /\saction=/i)
  assert.doesNotMatch(safe, /\sformaction=/i)
  assert.doesNotMatch(safe, /\smethod=/i)
  assert.doesNotMatch(safe, /\starget=/i)
  assert.doesNotMatch(safe, /\sdownload/i)
  assert.doesNotMatch(safe, /\sping=/i)
  assert.match(safe, /href="https:\/\/example\.com"/)
})

void test("sanitizer strips indirect URL-bearing attributes and unsafe inline styles", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<svg><a xlink:href="javascript:alert(1)">bad</a></svg>`,
      `<img srcset="javascript:alert(1) 1x, https://example.com/a.png 2x">`,
      `<div style="color: #111827; background-image:url(https://example.com/track.png); unknown: 1">x</div>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.doesNotMatch(safe, /xlink:href/i)
  assert.doesNotMatch(safe, /srcset/i)
  assert.doesNotMatch(safe, /javascript:/i)
  assert.doesNotMatch(safe, /url\(/i)
  assert.doesNotMatch(safe, /behavior/i)
  assert.doesNotMatch(safe, /unknown/i)
  assert.match(safe, /style="color: #111827;"/)
  assert.deepEqual(sanitized.dropped, [
    {
      node: "a",
      attribute: "xlink:href",
      value: "javascript:alert(1)",
      reason: "url_attribute",
    },
    {
      node: "img",
      attribute: "srcset",
      value: "javascript:alert(1) 1x, https://example.com/a.png 2x",
      reason: "url_attribute",
    },
    {
      node: "div",
      attribute: "style",
      value: "color: #111827; background-image:url(https://example.com/track.png); unknown: 1",
      reason: "unsafe_style_declaration",
    },
  ])
})

void test("sanitizer does not report safe style normalization as a drop", () => {
  const sanitized = sanitizeSurfaceHtml(`<div style="color:red">x</div>`, granted)

  assert.equal(sanitized.html, `<div style="color: red;">x</div>`)
  assert.deepEqual(sanitized.dropped, [])
})

void test("sanitizer preserves only granted capability calls", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<button data-genui-on-click="@capability('dice.roll', { sides: 6 }, { target: 'rollResult' })">Roll</button>`,
      `<select data-genui-on-change="@action('dice.roll', { sides: 8 }, { target: 'rollResult' })"></select>`,
      `<section data-genui-on-load="@action('dice.roll', { sides: 6 }, { target: 'rollResult' })">Load</section>`,
      `<section data-genui-on-load="@set('ready', true)">Local load</section>`,
      `<section data-genui-on-load="@action('notes.create', { text: 'Loaded' })">Write load</section>`,
      `<button data-genui-on-click="@capability('demo.secret', {})">Secret</button>`,
      `<select data-genui-on-change="@action('demo.secret', {})"></select>`,
      `<section data-genui-on-load="@action('demo.secret', {})">Secret load</section>`,
      `<table><tbody data-genui-each="$orders.value.items" data-genui-as="order"><tr><td data-genui-text="$order.id"></td><td><button data-genui-on-click="@capability('demo.secret', { id: $order.id })">Secret</button></td></tr></tbody></table>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.match(
    safe,
    /data-genui-on-click="@capability\('dice\.roll', \{ sides: 6 \}, \{ target: 'rollResult' \}\)"/,
  )
  assert.match(
    safe,
    /data-genui-on-change="@action\('dice\.roll', \{ sides: 8 \}, \{ target: 'rollResult' \}\)"/,
  )
  assert.match(
    safe,
    /data-genui-on-load="@action\('dice\.roll', \{ sides: 6 \}, \{ target: 'rollResult' \}\)"/,
  )
  assert.doesNotMatch(safe, /demo\.secret/)
  assert.match(safe, /data-genui-each="\$orders.value.items"/)
  assert.match(safe, /data-genui-as="order"/)
  assert.match(safe, /data-genui-text="\$order.id"/)
  assert.deepEqual(sanitized.dropped, [
    {
      node: "section",
      attribute: "data-genui-on-load",
      value: "@set('ready', true)",
      reason: "forbidden_load_action",
    },
    {
      node: "section",
      attribute: "data-genui-on-load",
      value: "@action('notes.create', { text: 'Loaded' })",
      reason: "forbidden_load_action",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@capability('demo.secret', {})",
      reason: "ungranted_action",
    },
    {
      node: "select",
      attribute: "data-genui-on-change",
      value: "@action('demo.secret', {})",
      reason: "ungranted_action",
    },
    {
      node: "section",
      attribute: "data-genui-on-load",
      value: "@action('demo.secret', {})",
      reason: "ungranted_action",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@capability('demo.secret', { id: $order.id })",
      reason: "ungranted_action",
    },
  ])
})

void test("sanitizer allows only row bindings inside keyed repeated templates", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<input data-genui-bind="outside" value="kept">`,
      `<div data-genui-state="{ row: 'bad', kept: true }">Reserved state</div>`,
      `<input data-genui-bind="row.note" value="bad static row">`,
      `<button data-genui-on-click="@set('row.editing', true)">Bad static edit row</button>`,
      `<button data-genui-on-click="@set('row', true)">Bad bare row</button>`,
      `<button data-genui-on-click="@action('dice.roll', {}, { target: 'row' })">Bad row target</button>`,
      `<section data-genui-each="$orders.value.items" data-genui-as="order" data-genui-key="$order.id" data-genui-bind="root" data-genui-on-load="@action('dice.roll', {})">`,
      `<input data-genui-bind="orderName" value="stripped">`,
      `<input data-genui-bind="row.note" data-genui-row-state="{ note: $order.note, editing: false }">`,
      `<button data-genui-on-click="@set('row.editing', true)">Edit row</button>`,
      `<button data-genui-on-load="@action('dice.roll', {})">Load row</button>`,
      `<span data-genui-text="$order.id"></span>`,
      `</section>`,
      `<section data-genui-each="$reserved.value.items" data-genui-as="row" data-genui-key="$row.id"></section>`,
      `<section data-genui-each="$drafts.value.items" data-genui-as="draft">`,
      `<input data-genui-bind="row.note" data-genui-row-state="{ note: $draft.note }">`,
      `<button data-genui-on-click="@set('row.editing', true)">Bad edit row</button>`,
      `</section>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.match(safe, /data-genui-bind="outside"/)
  assert.doesNotMatch(safe, /data-genui-state="\{ row: 'bad', kept: true \}"/)
  assert.doesNotMatch(safe, /bad static row" data-genui-bind/)
  assert.doesNotMatch(safe, /Bad static edit row" data-genui-on-click/)
  assert.doesNotMatch(safe, /Bad bare row" data-genui-on-click/)
  assert.doesNotMatch(safe, /target: 'row'/)
  assert.match(safe, /data-genui-each="\$orders.value.items"/)
  assert.match(safe, /data-genui-as="order"/)
  assert.match(safe, /data-genui-key="\$order.id"/)
  assert.match(safe, /data-genui-bind="row.note"/)
  assert.match(safe, /data-genui-row-state="\{ note: \$order.note, editing: false \}"/)
  assert.match(safe, /@set\('row.editing', true\)/)
  assert.match(safe, /data-genui-text="\$order.id"/)
  assert.doesNotMatch(safe, /data-genui-as="row"/)
  assert.doesNotMatch(safe, /data-genui-bind="root"/)
  assert.doesNotMatch(safe, /data-genui-bind="orderName"/)
  assert.doesNotMatch(safe, /\$draft.note/)
  assert.doesNotMatch(safe, /data-genui-on-load/)
  assert.deepEqual(sanitized.dropped, [
    {
      node: "div",
      attribute: "data-genui-state",
      value: "{ row: 'bad', kept: true }",
      reason: "reserved_row_path",
    },
    {
      node: "input",
      attribute: "data-genui-bind",
      value: "row.note",
      reason: "reserved_row_path",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@set('row.editing', true)",
      reason: "reserved_row_path",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@set('row', true)",
      reason: "reserved_row_path",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@action('dice.roll', {}, { target: 'row' })",
      reason: "reserved_row_path",
    },
    {
      node: "section",
      attribute: "data-genui-bind",
      value: "root",
      reason: "forbidden_repeated_template_attribute",
    },
    {
      node: "section",
      attribute: "data-genui-on-load",
      value: "@action('dice.roll', {})",
      reason: "forbidden_repeated_template_attribute",
    },
    {
      node: "input",
      attribute: "data-genui-bind",
      value: "orderName",
      reason: "forbidden_repeated_template_attribute",
    },
    {
      node: "button",
      attribute: "data-genui-on-load",
      value: "@action('dice.roll', {})",
      reason: "forbidden_repeated_template_attribute",
    },
    {
      node: "section",
      attribute: "data-genui-as",
      value: "row",
      reason: "reserved_row_path",
    },
    {
      node: "input",
      attribute: "data-genui-bind",
      value: "row.note",
      reason: "reserved_row_path",
    },
    {
      node: "input",
      attribute: "data-genui-row-state",
      value: "{ note: $draft.note }",
      reason: "forbidden_repeated_template_attribute",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@set('row.editing', true)",
      reason: "reserved_row_path",
    },
  ])
})

void test("sanitizer strips unsafe GenUI expressions", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<span data-genui-text="window.location">x</span>`,
      `<button data-genui-on-click="@capability('dice.roll', { sides: 6 }); fetch('/x')">Bad</button>`,
      `<span data-genui-state="{ count: 1 }" data-genui-text="$count">1</span>`,
      `<span data-genui-show="$status == 'pending' || ($count >= 3 && !$closed)">Loading</span>`,
      `<span data-genui-key="window.location">Bad key</span>`,
      `<span data-genui-text="formatCurrency($total, 'USD')">Total</span>`,
      `<span data-genui-text="formatUnknown($total)">Bad format</span>`,
      `<span data-genui-style-behavior="$count" data-genui-attr-onclick="$count">Bad dynamic attrs</span>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.doesNotMatch(safe, /window\.location/)
  assert.doesNotMatch(safe, /fetch/)
  assert.doesNotMatch(safe, /data-genui-on-click/)
  assert.match(safe, /data-genui-state="\{ count: 1 \}"/)
  assert.match(safe, /data-genui-text="\$count"/)
  assert.match(
    safe,
    /data-genui-show="\$status == 'pending' \|\| \(\$count >= 3 &amp;&amp; !\$closed\)"/,
  )
  assert.doesNotMatch(safe, /data-genui-key/)
  assert.match(safe, /data-genui-text="formatCurrency\(\$total, 'USD'\)"/)
  assert.doesNotMatch(safe, /formatUnknown/)
  assert.doesNotMatch(safe, /data-genui-style-behavior/)
  assert.doesNotMatch(safe, /data-genui-attr-onclick/)
  assert.deepEqual(sanitized.dropped, [
    {
      node: "span",
      attribute: "data-genui-text",
      value: "window.location",
      reason: "invalid_genui_expression",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6 }); fetch('/x')",
      reason: "invalid_genui_expression",
    },
    {
      node: "span",
      attribute: "data-genui-key",
      value: "window.location",
      reason: "invalid_genui_expression",
    },
    {
      node: "span",
      attribute: "data-genui-text",
      value: "formatUnknown($total)",
      reason: "invalid_genui_expression",
    },
    {
      node: "span",
      attribute: "data-genui-style-behavior",
      value: "$count",
      reason: "invalid_genui_attribute",
    },
    {
      node: "span",
      attribute: "data-genui-attr-onclick",
      value: "$count",
      reason: "invalid_genui_attribute",
    },
  ])
})

void test("sanitizer strips JavaScript-shaped constructor expressions", () => {
  const sanitized = sanitizeSurfaceHtml(
    [
      `<span data-genui-text="this['constructor']['constructor']('return 1')()">x</span>`,
      `<button data-genui-on-click="@capability('dice.roll', { sides: this['constructor']['constructor']('return 6')() })">Roll</button>`,
      `<span data-genui-text="$count">1</span>`,
    ].join(""),
    granted,
  )
  const safe = sanitized.html

  assert.doesNotMatch(safe, /constructor/)
  assert.doesNotMatch(safe, /data-genui-on-click/)
  assert.match(safe, /data-genui-text="\$count"/)
  assert.deepEqual(sanitized.dropped, [
    {
      node: "span",
      attribute: "data-genui-text",
      value: "this['constructor']['constructor']('return 1')()",
      reason: "invalid_genui_expression",
    },
    {
      node: "button",
      attribute: "data-genui-on-click",
      value:
        "@capability('dice.roll', { sides: this['constructor']['constructor']('return 6')() })",
      reason: "invalid_genui_expression",
    },
  ])
})

void test("sanitizer truncates dropped attribute values", () => {
  const longValue = "x".repeat(240)
  const sanitized = sanitizeSurfaceHtml(`<div data-genui-unknown="${longValue}"></div>`, granted)

  assert.equal(sanitized.dropped[0]?.reason, "unknown_genui_attribute")
  assert.equal(sanitized.dropped[0]?.value?.length, 200)
  assert.match(sanitized.dropped[0]?.value ?? "", /\.\.\.$/)
})

void test("sanitizer repairs truncated HTML and is idempotent", () => {
  const safe = sanitize(`<section><div><span data-genui-text="$label">Hi`)

  assert.equal(safe, `<section><div><span data-genui-text="$label">Hi</span></div></section>`)
  assert.equal(sanitize(safe), safe)
})

void test("sanitizer preserves text that contains a literal less-than character", () => {
  const safe = sanitize(`<p>2 < 3`)

  assert.equal(safe, `<p>2 &lt; 3</p>`)
})
