import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultResultTarget, normalizeResultTarget } from "./result-routing.js"

void test("result routing derives stable state targets from capability names", () => {
  assert.equal(defaultResultTarget("demo.weather.lookup"), "demoWeatherLookup")
  assert.equal(defaultResultTarget("dice.roll"), "diceRoll")
  assert.equal(normalizeResultTarget("forecast", "demo.weather.lookup"), "forecast")
  assert.equal(normalizeResultTarget("bad-target", "demo.weather.lookup"), "demoWeatherLookup")
})
