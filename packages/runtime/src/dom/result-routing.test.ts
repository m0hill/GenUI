import assert from "node:assert/strict"
import { test } from "node:test"
import {
  defaultResultTarget,
  normalizeResultTarget,
  resultStateFromCapabilityResult,
} from "./result-routing.js"

void test("result routing derives stable state targets from capability names", () => {
  assert.equal(defaultResultTarget("demo.weather.lookup"), "demoWeatherLookup")
  assert.equal(defaultResultTarget("dice.roll"), "diceRoll")
  assert.equal(normalizeResultTarget("forecast", "demo.weather.lookup"), "forecast")
  assert.equal(normalizeResultTarget("bad-target", "demo.weather.lookup"), "demoWeatherLookup")
})

void test("capability results project into request state", () => {
  assert.deepEqual(resultStateFromCapabilityResult({ ok: true, value: { total: 6 } }), {
    status: "complete",
    value: { total: 6 },
  })
  assert.deepEqual(
    resultStateFromCapabilityResult({
      ok: false,
      error: { code: "not_granted", message: "Capability is not granted." },
    }),
    { status: "error", error: "Capability is not granted." },
  )
})
