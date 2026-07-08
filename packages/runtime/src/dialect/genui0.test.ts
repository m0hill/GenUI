import assert from "node:assert/strict"
import { test } from "node:test"
import { Window } from "happy-dom"
import {
  applyGenui0RuntimeDirective,
  allowGenui0DataAttribute,
  genui0Dialect,
  genui0DirectiveInstructionLines,
  genui0DirectiveUsages,
  genui0Instructions,
  genui0RuntimeDirectiveFromAttribute,
} from "./genui0.js"

const grantedActions = new Set(["dice.roll"])

const runtimeContext = {
  isTruthy(value: unknown): boolean {
    return value !== false && value !== null && value !== undefined && value !== "" && value !== 0
  },
  shouldRemoveDynamicValue(value: unknown): boolean {
    return value === false || value === null || value === undefined
  },
  textValue(value: unknown): string {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  },
}

const runtimeDirective = (element: Element, attributeName: string) => {
  const attribute = element.getAttributeNode(attributeName)
  if (attribute === null) throw new Error(`Missing test attribute: ${attributeName}`)

  const directive = genui0RuntimeDirectiveFromAttribute({ element, attribute })
  if (directive === undefined) throw new Error(`Expected runtime directive: ${attributeName}`)
  return directive
}

void test("genui/0 exposes one internal dialect object", () => {
  assert.equal(genui0Dialect.id, "genui/0")
  assert.equal(genui0Dialect.sanitizer.allowDataAttribute, allowGenui0DataAttribute)
  assert.equal(genui0Dialect.runtime.directiveFromAttribute, genui0RuntimeDirectiveFromAttribute)
  assert.equal(genui0Dialect.runtime.applyDirective, applyGenui0RuntimeDirective)
  assert.equal(genui0Dialect.instructions, genui0Instructions)
})

void test("genui/0 allows only granted capability actions with v0 object inputs", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
      grantedActions,
    }),
    {
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
    },
  )

  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('demo.secret', {})",
      grantedActions,
    }),
    { reason: "ungranted_action" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value:
        "@capability('dice.roll', { sides: this['constructor']['constructor']('return 6')() })",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@capability('dice.roll', { sides: 6 }, { target: window.location })",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
})

void test("genui/0 allows simple local state expressions", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-state",
      value: "{ count: 1, label: 'Roll' }",
      grantedActions,
    }),
    { name: "data-genui-state", value: "{ count: 1, label: 'Roll' }" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "$count",
      grantedActions,
    }),
    { name: "data-genui-text", value: "$count" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-bind",
      value: "count",
      grantedActions,
    }),
    { name: "data-genui-bind", value: "count" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-each",
      value: "$orders.value.items",
      grantedActions,
    }),
    { name: "data-genui-each", value: "$orders.value.items" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-as",
      value: "order",
      grantedActions,
    }),
    { name: "data-genui-as", value: "order" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-show",
      value: "$status == 'pending' || ($count >= 3 && !$closed)",
      grantedActions,
    }),
    { name: "data-genui-show", value: "$status == 'pending' || ($count >= 3 && !$closed)" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "formatCurrency($total, 'USD')",
      grantedActions,
    }),
    { name: "data-genui-text", value: "formatCurrency($total, 'USD')" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@set('tab', 'details')",
      grantedActions,
    }),
    { name: "data-genui-on-click", value: "@set('tab', 'details')" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-style-background-color",
      value: "$color",
      grantedActions,
    }),
    { name: "data-genui-style-background-color", value: "$color" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-attr-aria-label",
      value: "$label",
      grantedActions,
    }),
    { name: "data-genui-attr-aria-label", value: "$label" },
  )
})

void test("genui/0 rejects general JavaScript expressions", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "window.location",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-show",
      value: "$count + 2",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-on-click",
      value: "@set('tab', window.location)",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-as",
      value: "bad-target",
      grantedActions,
    }),
    { reason: "invalid_genui_expression" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-style-behavior",
      value: "$value",
      grantedActions,
    }),
    { reason: "invalid_genui_attribute" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-attr-onclick",
      value: "$value",
      grantedActions,
    }),
    { reason: "invalid_genui_attribute" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-unknown",
      value: "$value",
      grantedActions,
    }),
    { reason: "unknown_genui_attribute" },
  )
})

void test("genui/0 owns repeated-template structural directive constraints", () => {
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-bind",
      value: "orderName",
      grantedActions,
      insideRepeatedTemplate: true,
    }),
    { reason: "forbidden_repeated_template_attribute" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-bind",
      value: "items",
      grantedActions,
      elementStartsRepeatedTemplate: true,
    }),
    { reason: "forbidden_repeated_template_attribute" },
  )
  assert.deepEqual(
    allowGenui0DataAttribute({
      name: "data-genui-text",
      value: "$order.name",
      grantedActions,
      insideRepeatedTemplate: true,
    }),
    { name: "data-genui-text", value: "$order.name" },
  )
})

void test("genui/0 owns runtime directive application", () => {
  const window = new Window()
  const document = window.document

  const text = document.createElement("p") as unknown as Element
  text.setAttribute("data-genui-text", "$label")
  applyGenui0RuntimeDirective(runtimeDirective(text, "data-genui-text"), "Ready", runtimeContext)
  assert.equal(text.textContent, "Ready")

  const show = document.createElement("p") as unknown as Element
  show.setAttribute("data-genui-show", "$open")
  const showDirective = runtimeDirective(show, "data-genui-show")
  applyGenui0RuntimeDirective(showDirective, false, runtimeContext)
  assert.equal(show.getAttribute("style"), "display: none;")
  applyGenui0RuntimeDirective(showDirective, true, runtimeContext)
  assert.equal(show.getAttribute("style") ?? "", "")

  const classValue = document.createElement("p") as unknown as Element
  classValue.className = "base"
  classValue.setAttribute("data-genui-class", "$tone")
  const classValueDirective = runtimeDirective(classValue, "data-genui-class")
  applyGenui0RuntimeDirective(classValueDirective, "accent", runtimeContext)
  assert.equal(classValue.className, "base accent")
  applyGenui0RuntimeDirective(classValueDirective, "", runtimeContext)
  assert.equal(classValue.className, "base")

  const classToggle = document.createElement("p") as unknown as Element
  classToggle.setAttribute("data-genui-class-is-active", "$active")
  const classToggleDirective = runtimeDirective(classToggle, "data-genui-class-is-active")
  applyGenui0RuntimeDirective(classToggleDirective, true, runtimeContext)
  assert.equal(classToggle.classList.contains("is-active"), true)
  applyGenui0RuntimeDirective(classToggleDirective, false, runtimeContext)
  assert.equal(classToggle.classList.contains("is-active"), false)

  const style = document.createElement("p") as unknown as Element
  style.setAttribute("data-genui-style-background-color", "$color")
  const styleDirective = runtimeDirective(style, "data-genui-style-background-color")
  applyGenui0RuntimeDirective(styleDirective, "red", runtimeContext)
  assert.equal(style.getAttribute("style"), "background-color: red;")
  applyGenui0RuntimeDirective(styleDirective, "url(https://example.com/x.png)", runtimeContext)
  assert.equal(style.getAttribute("style") ?? "", "")

  const attribute = document.createElement("p") as unknown as Element
  attribute.setAttribute("data-genui-attr-aria-label", "$label")
  const attributeDirective = runtimeDirective(attribute, "data-genui-attr-aria-label")
  applyGenui0RuntimeDirective(attributeDirective, "Details", runtimeContext)
  assert.equal(attribute.getAttribute("aria-label"), "Details")
  applyGenui0RuntimeDirective(attributeDirective, false, runtimeContext)
  assert.equal(attribute.hasAttribute("aria-label"), false)
})

void test("genui/0 instructions describe dialect and capability descriptors", () => {
  const instructions = genui0Instructions([
    {
      name: "dice.roll",
      description: "Roll a die.",
      effect: "read",
      requiresApproval: false,
    },
  ])

  assert.match(instructions, /Generated UI dialect: genui\/0/)
  assert.match(instructions, /data-genui-on-submit/)
  assert.match(instructions, /data-genui-each/)
  assert.match(instructions, /data-genui-as/)
  assert.match(instructions, /@set\('state\.path', value\)/)
  assert.match(instructions, /data-genui-as="order"/)
  assert.match(instructions, /\$order\.id and \$line\.id/)
  assert.match(instructions, /\$orders\.value\.items\.length/)
  assert.match(instructions, /do not put data-genui-bind inside data-genui-each/)
  assert.match(instructions, /dice\.roll: Roll a die\./)
  assert.match(instructions, /target: 'resultName'/)
  assert.match(instructions, /\$target\.status/)
  assert.match(instructions, /\$target\.value/)
  assert.match(instructions, /\$target\.error/)
  assert.match(instructions, /'pending', 'complete', or 'error'/)
  assert.match(instructions, /orders\.search writes to \$ordersSearch/)
  assert.match(instructions, /Expression v0\.5/)
  assert.match(instructions, /formatCurrency/)
})

void test("genui/0 instructions include every directive usage and directive line", () => {
  const instructions = genui0Instructions([])

  for (const usage of genui0DirectiveUsages) {
    assert.equal(instructions.includes(usage), true, usage)
  }
  for (const line of genui0DirectiveInstructionLines) {
    assert.equal(instructions.includes(line), true, line)
  }
})
