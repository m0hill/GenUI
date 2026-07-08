import assert from "node:assert/strict"
import { test } from "node:test"
import { genui0Language } from "./genui0-language.js"

void test("genui/0 language validates capability names", () => {
  assert.equal(genui0Language.isCapabilityName("dice.roll"), true)
  assert.equal(genui0Language.isCapabilityName("demo.weather_lookup"), true)
  assert.equal(genui0Language.isCapabilityName("dice"), false)
  assert.equal(genui0Language.isCapabilityName("Dice Roll"), false)
  assert.equal(genui0Language.isCapabilityName("1dice.roll"), false)
})

void test("genui/0 language parses capability actions", () => {
  assert.deepEqual(
    genui0Language.parseCapabilityAction(
      "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
    ),
    {
      capability: "dice.roll",
      inputExpression: "{ sides: 6, label: $label }",
      target: "rollResult",
    },
  )
  assert.deepEqual(genui0Language.parseCapabilityAction(`@capability("notes.create", {})`), {
    capability: "notes.create",
    inputExpression: "{}",
  })
})

void test("genui/0 language rejects unsupported capability action syntax", () => {
  assert.equal(
    genui0Language.parseCapabilityAction("@capability ('dice.roll', { sides: 6 })"),
    undefined,
  )
  assert.equal(
    genui0Language.parseCapabilityAction("@capability('dice.roll', { sides: 6 },)"),
    undefined,
  )
  assert.equal(
    genui0Language.parseCapabilityAction("@capability('dice.roll', { sides: window.location })"),
    undefined,
  )
  assert.equal(
    genui0Language.parseCapabilityAction(
      "@capability('dice.roll', { sides: 6 }, { target: $target })",
    ),
    undefined,
  )
  assert.equal(
    genui0Language.parseCapabilityAction("@capability('dice.roll', { nested: { value: 1 } })"),
    undefined,
  )
})

void test("genui/0 language parses local set actions", () => {
  assert.deepEqual(genui0Language.parseSetAction("@set('tab', 'details')"), {
    pathExpression: "tab",
    valueExpression: "'details'",
  })
  assert.deepEqual(genui0Language.parseSetAction("@set('panel.open', true)"), {
    pathExpression: "panel.open",
    valueExpression: "true",
  })
  assert.equal(genui0Language.parseSetAction("@set('tab', window.location)"), undefined)
  assert.equal(genui0Language.parseSetAction("@set ('tab', 'details')"), undefined)
  assert.equal(genui0Language.parseSetAction("@set('bad-target', 'x')"), undefined)
  assert.equal(genui0Language.parseSetAction("@set($target, 'x')"), undefined)
})

void test("genui/0 language validates safe expressions", () => {
  assert.equal(genui0Language.isSafeObjectExpression("{ count: 1, label: 'Roll', ok: true }"), true)
  assert.equal(genui0Language.isSafeObjectExpression("{ bad: window.location }"), false)
  assert.equal(genui0Language.isSafeObjectExpression("{ count: 1, }"), false)
  assert.equal(genui0Language.isSafeObjectExpression("{ nested: { value: 1 } }"), false)

  assert.equal(genui0Language.isSafeSimpleExpression("$count"), true)
  assert.equal(genui0Language.isSafeSimpleExpression("$status == 'pending'"), true)
  assert.equal(genui0Language.isSafeSimpleExpression("$status != 'error'"), true)
  assert.equal(genui0Language.isSafeSimpleExpression("{ count: 1 }"), true)
  assert.equal(genui0Language.isSafeSimpleExpression("$count > 2"), false)

  assert.equal(genui0Language.isSafeBindingExpression("count"), true)
  assert.equal(genui0Language.isSafeBindingExpression("$rollResult.value.total"), true)
  assert.equal(genui0Language.isSafeBindingExpression("count + 1"), false)
})

void test("genui/0 language treats prototype-shaped object keys as data only", () => {
  const pollutionKey = "genuiPolluted"
  Reflect.deleteProperty(Object.prototype, pollutionKey)

  try {
    assert.equal(genui0Language.isSafeObjectExpression("{ __proto__: 'polluted' }"), false)
    assert.equal(genui0Language.isSafeObjectExpression("{ '__proto__': 'polluted' }"), false)

    const parsed = genui0Language.parseObjectLiteral(
      "{ constructor: 'owned', prototype: 'owned' }",
      () => "",
    )
    assert.notEqual(parsed, genui0Language.invalid)
    assert.equal(typeof parsed, "object")
    assert.notEqual(parsed, null)

    const record = parsed as Readonly<Record<string, unknown>>
    assert.equal(Object.prototype.hasOwnProperty.call(record, "constructor"), true)
    assert.equal(Object.prototype.hasOwnProperty.call(record, "prototype"), true)
    assert.equal(record.constructor, "owned")
    assert.equal(record.prototype, "owned")
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey), undefined)
  } finally {
    Reflect.deleteProperty(Object.prototype, pollutionKey)
  }
})

void test("genui/0 language owns result target normalization", () => {
  assert.equal(genui0Language.defaultResultTarget("demo.weather.lookup"), "demoWeatherLookup")
  assert.equal(genui0Language.defaultResultTarget("dice.roll"), "diceRoll")
  assert.equal(genui0Language.normalizeResultTarget("forecast", "demo.weather.lookup"), "forecast")
  assert.equal(
    genui0Language.normalizeResultTarget("bad-target", "demo.weather.lookup"),
    "demoWeatherLookup",
  )
})
