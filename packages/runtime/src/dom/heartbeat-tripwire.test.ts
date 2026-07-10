import assert from "node:assert/strict"
import { test } from "node:test"
import { createHeartbeatTripwire, type HeartbeatTripwire } from "./heartbeat-tripwire.js"

interface TripwireHarness {
  readonly tripwire: HeartbeatTripwire
  readonly checkIntervalMs: number
  readonly violations: string[]
  advanceAndCheck(milliseconds: number): void
  wasCancelled(): boolean
}

const createHarness = (): TripwireHarness => {
  let currentTime = 0
  let check: (() => void) | undefined
  let checkIntervalMs = 0
  let cancelled = false
  const violations: string[] = []
  const tripwire = createHeartbeatTripwire({
    now: () => currentTime,
    schedule: (scheduledCheck, intervalMs) => {
      check = scheduledCheck
      checkIntervalMs = intervalMs
      return () => {
        cancelled = true
      }
    },
    onUnresponsive: () => violations.push("unresponsive"),
  })

  return {
    tripwire,
    get checkIntervalMs() {
      return checkIntervalMs
    },
    violations,
    advanceAndCheck(milliseconds) {
      currentTime += milliseconds
      check?.()
    },
    wasCancelled: () => cancelled,
  }
}

void test("heartbeat tripwire fires only after a visible intersecting gap over six seconds", () => {
  const harness = createHarness()
  harness.tripwire.setDocumentVisible(true)
  harness.tripwire.setIntersecting(true)

  assert.equal(harness.checkIntervalMs, 1_000)
  harness.advanceAndCheck(6_000)
  assert.deepEqual(harness.violations, [])

  harness.advanceAndCheck(1)
  harness.advanceAndCheck(1_000)
  assert.deepEqual(harness.violations, ["unresponsive"])
})

void test("heartbeat tripwire pauses while hidden and grants fresh time after resume", () => {
  const harness = createHarness()
  harness.tripwire.setDocumentVisible(true)
  harness.tripwire.setIntersecting(true)
  harness.tripwire.setDocumentVisible(false)

  harness.advanceAndCheck(60_000)
  assert.deepEqual(harness.violations, [])

  harness.tripwire.setDocumentVisible(true)
  harness.advanceAndCheck(6_000)
  assert.deepEqual(harness.violations, [])
  harness.advanceAndCheck(1)
  assert.deepEqual(harness.violations, ["unresponsive"])
})

void test("heartbeat tripwire pauses offscreen and resets on a heartbeat", () => {
  const harness = createHarness()
  harness.tripwire.setDocumentVisible(true)

  harness.advanceAndCheck(60_000)
  assert.deepEqual(harness.violations, [])

  harness.tripwire.setIntersecting(true)
  harness.advanceAndCheck(5_000)
  harness.tripwire.heartbeat()
  harness.advanceAndCheck(6_000)
  assert.deepEqual(harness.violations, [])
  harness.advanceAndCheck(1)
  assert.deepEqual(harness.violations, ["unresponsive"])
})

void test("heartbeat tripwire resets for replacement and cancels on dispose", () => {
  const harness = createHarness()
  harness.tripwire.setDocumentVisible(true)
  harness.tripwire.setIntersecting(true)
  harness.advanceAndCheck(6_001)
  assert.deepEqual(harness.violations, ["unresponsive"])

  harness.tripwire.reset()
  harness.advanceAndCheck(6_000)
  assert.deepEqual(harness.violations, ["unresponsive"])

  harness.tripwire.dispose()
  harness.advanceAndCheck(1)
  assert.equal(harness.wasCancelled(), true)
  assert.deepEqual(harness.violations, ["unresponsive"])
})
