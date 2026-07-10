import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluateFixtures, formatEvaluationReport } from "./eval-runner.js"

void test("evaluation rig passes a known-good generated surface", async () => {
  const report = await evaluateFixtures({
    fixturesDirectory: new URL("../fixtures/incoming/", import.meta.url),
  })

  assert.equal(report.passed, true)
  assert.equal(report.fixtures.length, 1)
  assert.equal(report.fixtures[0]?.name, "orders-search.html")
  assert.deepEqual(report.fixtures[0]?.checks, {
    mounted: true,
    noGuestErrors: true,
    noViolations: true,
    grantedCallsSucceeded: true,
    ungrantedCallsDenied: true,
    expectedCallsMatched: true,
  })

  const markdown = formatEvaluationReport(report)
  assert.match(markdown, /^\| Fixture \| Mounted \| Guest errors \|/)
  assert.match(markdown, /\| orders-search\.html .*\| PASS \|/)
})

void test("evaluation rig fails loudly for bad and malicious surfaces", async () => {
  const report = await evaluateFixtures({
    fixturesDirectory: new URL("../fixtures/cases/", import.meta.url),
  })

  assert.equal(report.passed, false)
  assert.equal(report.fixtures.length, 2)

  const guestError = report.fixtures.find((fixture) => fixture.name === "guest-error.html")
  assert.ok(guestError)
  assert.equal(guestError.checks.noGuestErrors, false)
  assert.equal(guestError.passed, false)

  const malicious = report.fixtures.find((fixture) => fixture.name === "malicious.html")
  assert.ok(malicious)
  assert.equal(malicious.checks.noViolations, false)
  assert.equal(malicious.checks.ungrantedCallsDenied, true)
  assert.equal(malicious.passed, false)
  assert.deepEqual(
    malicious.events
      .filter(
        (event): event is Readonly<Record<string, unknown>> =>
          typeof event === "object" && event !== null && !Array.isArray(event),
      )
      .filter((event) => event.type === "violation")
      .map((event) => event.reason),
    ["ungranted_call", "navigation"],
  )

  const markdown = formatEvaluationReport(report)
  assert.match(markdown, /## guest-error\.html/)
  assert.match(markdown, /Failing assertion: .*Known bad fixture failure/)
  assert.match(markdown, /"type": "guest_error"/)
  assert.match(markdown, /## malicious\.html/)
  assert.match(markdown, /Failing assertion: .*ungranted_call.*navigation/)
  assert.match(markdown, /"reason": "navigation"/)
})
