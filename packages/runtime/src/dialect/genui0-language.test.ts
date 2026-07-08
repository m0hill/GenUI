import assert from "node:assert/strict"
import { test } from "node:test"
import {
  defaultGenui0ResultTarget,
  isGenui0CapabilityName,
  isSafeGenui0BindingExpression,
  isSafeGenui0ObjectExpression,
  isSafeGenui0SimpleExpression,
  normalizeGenui0ResultTarget,
  parseGenui0CapabilityAction,
} from "./genui0-language.js"

void test("genui/0 language validates capability names", () => {
  assert.equal(isGenui0CapabilityName("dice.roll"), true)
  assert.equal(isGenui0CapabilityName("demo.weather_lookup"), true)
  assert.equal(isGenui0CapabilityName("dice"), false)
  assert.equal(isGenui0CapabilityName("Dice Roll"), false)
  assert.equal(isGenui0CapabilityName("1dice.roll"), false)
})

void test("genui/0 language parses capability actions", () => {
  assert.deepEqual(
    parseGenui0CapabilityAction(
      "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
    ),
    {
      capability: "dice.roll",
      inputExpression: "{ sides: 6, label: $label }",
      target: "rollResult",
    },
  )
  assert.deepEqual(parseGenui0CapabilityAction(`@capability("notes.create", {})`), {
    capability: "notes.create",
    inputExpression: "{}",
  })
})

void test("genui/0 language rejects unsupported capability action syntax", () => {
  assert.equal(
    parseGenui0CapabilityAction("@capability('dice.roll', { sides: window.location })"),
    undefined,
  )
  assert.equal(
    parseGenui0CapabilityAction("@capability('dice.roll', { sides: 6 }, { target: $target })"),
    undefined,
  )
  assert.equal(
    parseGenui0CapabilityAction("@capability('dice.roll', { nested: { value: 1 } })"),
    undefined,
  )
})

void test("genui/0 language validates safe expressions", () => {
  assert.equal(isSafeGenui0ObjectExpression("{ count: 1, label: 'Roll', ok: true }"), true)
  assert.equal(isSafeGenui0ObjectExpression("{ bad: window.location }"), false)
  assert.equal(isSafeGenui0ObjectExpression("{ nested: { value: 1 } }"), false)

  assert.equal(isSafeGenui0SimpleExpression("$count"), true)
  assert.equal(isSafeGenui0SimpleExpression("{ count: 1 }"), true)
  assert.equal(isSafeGenui0SimpleExpression("$count > 2"), false)

  assert.equal(isSafeGenui0BindingExpression("count"), true)
  assert.equal(isSafeGenui0BindingExpression("$rollResult.value.total"), true)
  assert.equal(isSafeGenui0BindingExpression("count + 1"), false)
})

void test("genui/0 language owns result target normalization", () => {
  assert.equal(defaultGenui0ResultTarget("demo.weather.lookup"), "demoWeatherLookup")
  assert.equal(defaultGenui0ResultTarget("dice.roll"), "diceRoll")
  assert.equal(normalizeGenui0ResultTarget("forecast", "demo.weather.lookup"), "forecast")
  assert.equal(
    normalizeGenui0ResultTarget("bad-target", "demo.weather.lookup"),
    "demoWeatherLookup",
  )
})
