import assert from "node:assert/strict"
import { test } from "node:test"
import { parseHostContext } from "./host-context.js"

void test("host context accepts independent fixed and flexible dimension modes", () => {
  const dimensions = [
    {},
    { width: 400 },
    { maxWidth: 800 },
    { height: 500 },
    { maxHeight: 720 },
    { width: 400, height: 500 },
    { width: 400, maxHeight: 720 },
    { maxWidth: 800, height: 500 },
    { maxWidth: 800, maxHeight: 720 },
    { width: 0, maxHeight: 0 },
    { width: 400.5, maxHeight: 720.25 },
  ]

  for (const containerDimensions of dimensions) {
    assert.deepEqual(parseHostContext({ containerDimensions }), { containerDimensions })
  }
})

void test("host context preserves and copies validated runtime fields", () => {
  const input = {
    theme: "dark",
    styles: { variables: { "--color-text-primary": "#123456" } },
    containerDimensions: { width: 480, maxHeight: 720 },
    locale: "EN-us",
    timeZone: "Etc/UTC",
    platform: "desktop",
  }

  const context = parseHostContext(input)
  input.containerDimensions.width = 960
  input.styles.variables["--color-text-primary"] = "#abcdef"

  assert.deepEqual(context, {
    theme: "dark",
    styles: { variables: { "--color-text-primary": "#123456" } },
    containerDimensions: { width: 480, maxHeight: 720 },
    locale: "EN-us",
    timeZone: "Etc/UTC",
    platform: "desktop",
  })
  assert.deepEqual(
    parseHostContext({
      theme: undefined,
      containerDimensions: undefined,
      locale: undefined,
      timeZone: undefined,
      platform: undefined,
    }),
    {},
  )
})

void test("host context rejects malformed dimensions and runtime fields", () => {
  const invalidContexts: readonly unknown[] = [
    { containerDimensions: { width: 1, maxWidth: 2 } },
    { containerDimensions: { height: 1, maxHeight: 2 } },
    { containerDimensions: { width: -1 } },
    { containerDimensions: { maxHeight: Number.NaN } },
    { containerDimensions: { height: Number.POSITIVE_INFINITY } },
    { containerDimensions: { maxWidth: "400" } },
    { containerDimensions: { width: undefined } },
    { containerDimensions: { inlineSize: 400 } },
    { locale: "" },
    { locale: "not_a_locale" },
    { locale: "a".repeat(129) },
    { timeZone: "" },
    { timeZone: "Moon/Tranquility" },
    { timeZone: "a".repeat(129) },
    { platform: "tablet" },
    { language: "en-US" },
    Object.create({ locale: "en-US" }),
    Object.create({ containerDimensions: { width: 400 } }),
  ]

  for (const context of invalidContexts) {
    assert.throws(() => parseHostContext(context), TypeError)
  }
})
