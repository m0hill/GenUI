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
