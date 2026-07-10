import { evaluateFixtures, formatEvaluationReport } from "./eval-runner.js"

try {
  const report = await evaluateFixtures({
    fixturesDirectory: new URL("../fixtures/incoming/", import.meta.url),
  })
  process.stdout.write(formatEvaluationReport(report))
  if (!report.passed) process.exitCode = 1
} catch (error) {
  process.stderr.write(
    `Evaluation failed: ${error instanceof Error ? error.message : "Unknown evaluation error."}\n`,
  )
  process.exitCode = 1
}
