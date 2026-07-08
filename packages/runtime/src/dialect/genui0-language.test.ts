import assert from "node:assert/strict"
import { test } from "node:test"
import { Window } from "happy-dom"
import { jsonRoundTrip } from "../test-support.test-support.js"
import {
  createGenui0Language,
  defaultGenui0ResultTarget,
  genui0SandboxLanguageScript,
  isGenui0CapabilityName,
  isSafeGenui0BindingExpression,
  isSafeGenui0ObjectExpression,
  isSafeGenui0SimpleExpression,
  normalizeGenui0ResultTarget,
  parseGenui0CapabilityAction,
  type Genui0Language,
} from "./genui0-language.js"

interface SandboxLanguageGlobal {
  __genui0LanguageForTest?: Pick<
    Genui0Language,
    "invalid" | "parseObjectLiteral" | "parseCapabilityExpression"
  >
}

const sandboxLanguageFromGeneratedScript = (): NonNullable<
  SandboxLanguageGlobal["__genui0LanguageForTest"]
> => {
  const window = new Window()
  const global = window as unknown as SandboxLanguageGlobal

  window.eval(`
    ${genui0SandboxLanguageScript()}
    globalThis.__genui0LanguageForTest = {
      invalid: genui0Invalid,
      parseObjectLiteral: genui0ParseObjectLiteral,
      parseCapabilityExpression: parseGenui0CapabilityExpression,
    };
  `)

  const language = global.__genui0LanguageForTest
  if (language === undefined) throw new Error("Generated genui/0 language was not installed.")
  return language
}

const readState = (expression: string): unknown => {
  if (expression === "$label") return "Lucky"
  if (expression === "$sides") return 6
  return ""
}

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
  assert.equal(isSafeGenui0SimpleExpression("$status == 'pending'"), true)
  assert.equal(isSafeGenui0SimpleExpression("$status != 'error'"), true)
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

void test("generated sandbox language matches sanitizer capability grammar", () => {
  const directLanguage = createGenui0Language()
  const sandboxLanguage = sandboxLanguageFromGeneratedScript()

  for (const expression of [
    "@capability('dice.roll', { sides: 6, label: $label }, { target: 'rollResult' })",
    `@capability("notes.create", {})`,
    "@capability('dice.roll', { sides: window.location })",
    "@capability('dice.roll', { sides: 6 }, { target: $target })",
    "@capability('dice.roll', { nested: { value: 1 } })",
  ]) {
    const sanitizerAction = parseGenui0CapabilityAction(expression)
    const directAction = directLanguage.parseCapabilityExpression(expression, readState)
    const sandboxAction = sandboxLanguage.parseCapabilityExpression(expression, readState)

    assert.equal(directAction !== undefined, sanitizerAction !== undefined, expression)
    assert.deepEqual(jsonRoundTrip(sandboxAction), jsonRoundTrip(directAction), expression)
  }
})

void test("generated sandbox language matches sanitizer object-expression grammar", () => {
  const sandboxLanguage = sandboxLanguageFromGeneratedScript()

  for (const expression of [
    "{ count: 1, label: 'Roll', ok: true }",
    "{ sides: $sides, label: $label }",
    "{ bad: window.location }",
    "{ nested: { value: 1 } }",
    "{ bad: ['x'] }",
  ]) {
    const sandboxValue = sandboxLanguage.parseObjectLiteral(expression, readState)

    assert.equal(
      sandboxValue !== sandboxLanguage.invalid,
      isSafeGenui0ObjectExpression(expression),
      expression,
    )
  }
})
