import { readFile, readdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { serve, type ServerType } from "@hono/node-server"
import { chromium, type Browser, type Page, type Request } from "playwright"
import { app, resetPlaygroundState } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import {
  parseExpectedCalls,
  parsePlaygroundEvent,
  parseRecord,
  type PlaygroundEvent,
} from "./playground-codecs.js"

interface EvaluationChecks {
  readonly mounted: boolean
  readonly noGuestErrors: boolean
  readonly noViolations: boolean
  readonly grantedCallsSucceeded: boolean
  readonly ungrantedCallsDenied: boolean
  readonly expectedCallsMatched: boolean
}

interface FixtureEvaluation {
  readonly name: string
  readonly checks: EvaluationChecks
  readonly expectationProvided: boolean
  readonly passed: boolean
  readonly failures: readonly string[]
  readonly events: readonly PlaygroundEvent[]
}

interface EvaluationReport {
  readonly fixtures: readonly FixtureEvaluation[]
  readonly errors: readonly string[]
  readonly passed: boolean
}

interface EvaluateFixturesOptions {
  readonly fixturesDirectory: string | URL
  readonly quietMs?: number
  readonly timeoutMs?: number
}

interface LoadedExpectation {
  readonly calls?: ReturnType<typeof parseExpectedCalls>
  readonly error?: string
}

const loadExpectation = async (htmlPath: string): Promise<LoadedExpectation> => {
  const jsonPath = htmlPath.replace(/\.html$/i, ".json")
  let source: string
  try {
    source = await readFile(jsonPath, "utf8")
  } catch (error) {
    if (parseRecord(error)?.code === "ENOENT") return {}
    return { error: `Could not read ${basename(jsonPath)}.` }
  }

  try {
    return { calls: parseExpectedCalls(JSON.parse(source) as unknown) }
  } catch (error) {
    return {
      error: `${basename(jsonPath)}: ${error instanceof Error ? error.message : "Invalid JSON."}`,
    }
  }
}

const startServer = async (): Promise<{ readonly origin: string; readonly server: ServerType }> =>
  new Promise((resolveStart) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolveStart({ origin: `http://127.0.0.1:${info.port}`, server })
    })
  })

const closeServer = async (server: ServerType): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    server.close((error?: Error) => {
      if (error === undefined) resolveClose()
      else rejectClose(error)
    })
  })

const waitForQuiet = async (
  page: Page,
  pendingExecutions: ReadonlySet<Request>,
  quietMs: number,
  timeoutMs: number,
): Promise<void> => {
  const events = page.locator("#event-log > li")
  let count = await events.count()
  let quietSince = Date.now()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const nextCount = await events.count()
    if (nextCount !== count || pendingExecutions.size > 0) {
      count = nextCount
      quietSince = Date.now()
    }
    if (pendingExecutions.size === 0 && Date.now() - quietSince >= quietMs) return
    await page.waitForTimeout(Math.min(25, quietMs))
  }

  throw new Error(`Surface did not become quiet within ${timeoutMs}ms.`)
}

const readEvents = async (page: Page): Promise<readonly PlaygroundEvent[]> => {
  const encoded = await page.locator("#event-log > li").allTextContents()
  return encoded.map((value, index) => {
    const decoded: unknown = JSON.parse(value)
    const event = parsePlaygroundEvent(decoded)
    if (event === undefined) throw new Error(`Event ${index + 1} is malformed.`)
    return event
  })
}

const evaluatePage = async (
  browser: Browser,
  origin: string,
  htmlPath: string,
  quietMs: number,
  timeoutMs: number,
): Promise<FixtureEvaluation> => {
  resetDemoOrders()
  resetPlaygroundState()

  const name = basename(htmlPath)
  const failures: string[] = []
  const expectation = await loadExpectation(htmlPath)
  if (expectation.error !== undefined) failures.push(expectation.error)

  const context = await browser.newContext()
  const page = await context.newPage()
  const pendingExecutions = new Set<Request>()
  const pageErrors: string[] = []

  page.on("dialog", (dialog) => void dialog.accept())
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/genui/execute") {
      pendingExecutions.add(request)
    }
  })
  const finishRequest = (request: Request): void => {
    pendingExecutions.delete(request)
  }
  page.on("requestfinished", finishRequest)
  page.on("requestfailed", finishRequest)

  let mounted = false
  let events: readonly PlaygroundEvent[] = []

  try {
    const content = await readFile(htmlPath, "utf8")
    await page.goto(origin)
    await page.locator("#surface-source").fill(content)
    await page.locator("#create-surface").click()
    await page.waitForFunction(() => {
      const status = document.querySelector<HTMLOutputElement>("#host-status")
      return (
        status?.textContent?.startsWith("Mounted ") === true || status?.dataset.error === "true"
      )
    })

    const status = await page.locator("#host-status").textContent()
    mounted = status?.startsWith("Mounted ") === true
    if (!mounted) failures.push(`Surface did not mount: ${status ?? "no host status"}`)

    if (mounted) {
      await Promise.race([
        page
          .frameLocator("#surface iframe")
          .locator("body")
          .waitFor({ state: "attached", timeout: timeoutMs }),
        page.locator("#event-log > li").first().waitFor({ state: "attached", timeout: timeoutMs }),
      ])
      await waitForQuiet(page, pendingExecutions, quietMs, timeoutMs)
    }
    events = await readEvents(page)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Fixture evaluation failed.")
    events = await readEvents(page).catch(() => [])
  } finally {
    await context.close()
  }

  for (const message of pageErrors) failures.push(`Page error: ${message}`)

  const calls = events.filter((event) => event.type === "call")
  const results = events.filter((event) => event.type === "result")
  const violations = events.filter((event) => event.type === "violation")
  const guestErrors = events.filter((event) => event.type === "guest_error")
  const callIds = new Set(calls.map((event) => event.call.callId))
  const ungrantedViolations = violations.filter((event) => event.reason === "ungranted_call")
  const ungrantedResults = results.filter((event) => !callIds.has(event.callId))

  const noGuestErrors = guestErrors.length === 0
  const noViolations = violations.length === 0
  const grantedCallsSucceeded = calls.every(
    (event) =>
      results.find(
        (candidate) =>
          candidate.callId === event.call.callId && candidate.action === event.call.action,
      )?.result.ok === true,
  )
  const ungrantedCallsDenied =
    ungrantedViolations.length === ungrantedResults.length &&
    ungrantedResults.every(
      (event) => event.result.ok === false && event.result.error.code === "not_granted",
    )
  const actualCalls = calls.map((event) => ({
    action: event.call.action,
    input: event.call.input,
  }))
  const expectedCallsMatched =
    expectation.error === undefined &&
    (expectation.calls === undefined || isDeepStrictEqual(actualCalls, expectation.calls))

  if (!noGuestErrors) {
    failures.push(`Guest error: ${guestErrors.map((event) => event.message).join("; ")}`)
  }
  if (!noViolations) {
    failures.push(`Violations: ${violations.map((event) => event.reason).join(", ")}`)
  }
  if (!grantedCallsSucceeded) failures.push("One or more granted calls did not succeed.")
  if (!ungrantedCallsDenied) failures.push("One or more ungranted calls were not denied.")
  if (!expectedCallsMatched && expectation.error === undefined) {
    failures.push(
      `Expected calls ${JSON.stringify(expectation.calls)}, received ${JSON.stringify(actualCalls)}.`,
    )
  }

  const checks = {
    mounted,
    noGuestErrors,
    noViolations,
    grantedCallsSucceeded,
    ungrantedCallsDenied,
    expectedCallsMatched,
  }
  return {
    name,
    checks,
    expectationProvided: expectation.calls !== undefined,
    passed: failures.length === 0 && Object.values(checks).every(Boolean),
    failures,
    events,
  }
}

export const evaluateFixtures = async (
  options: EvaluateFixturesOptions,
): Promise<EvaluationReport> => {
  const fixturesDirectory =
    options.fixturesDirectory instanceof URL
      ? fileURLToPath(options.fixturesDirectory)
      : resolve(options.fixturesDirectory)
  const entries = await readdir(fixturesDirectory, { withFileTypes: true })
  const fixtureNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  if (fixtureNames.length === 0) {
    return {
      fixtures: [],
      errors: [`No .html fixtures found in ${fixturesDirectory}.`],
      passed: false,
    }
  }

  const { origin, server } = await startServer()
  let browser: Browser | undefined
  const fixtures: FixtureEvaluation[] = []
  try {
    browser = await chromium.launch()
    for (const name of fixtureNames) {
      fixtures.push(
        await evaluatePage(
          browser,
          origin,
          join(fixturesDirectory, name),
          options.quietMs ?? 200,
          options.timeoutMs ?? 5_000,
        ),
      )
    }
  } finally {
    try {
      await browser?.close()
    } finally {
      await closeServer(server)
    }
  }

  return {
    fixtures,
    errors: [],
    passed: fixtures.every((fixture) => fixture.passed),
  }
}

const resultCell = (passed: boolean): string => (passed ? "PASS" : "FAIL")

export const formatEvaluationReport = (report: EvaluationReport): string => {
  const lines = [
    "| Fixture | Mounted | Guest errors | Violations | Granted calls | Ungranted denied | Expected calls | Result |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]

  for (const fixture of report.fixtures) {
    const fixtureName = fixture.name.replaceAll("|", "\\|").replaceAll("\n", " ")
    lines.push(
      `| ${fixtureName} | ${resultCell(fixture.checks.mounted)} | ${resultCell(fixture.checks.noGuestErrors)} | ${resultCell(fixture.checks.noViolations)} | ${resultCell(fixture.checks.grantedCallsSucceeded)} | ${resultCell(fixture.checks.ungrantedCallsDenied)} | ${fixture.expectationProvided ? resultCell(fixture.checks.expectedCallsMatched) : "N/A"} | ${resultCell(fixture.passed)} |`,
    )
  }

  if (report.errors.length > 0) {
    lines.push("", "## Evaluation errors")
    for (const error of report.errors) lines.push(`- ${error}`)
  }

  for (const fixture of report.fixtures.filter((candidate) => !candidate.passed)) {
    lines.push("", `## ${fixture.name}`)
    for (const failure of fixture.failures) {
      lines.push(`- Failing assertion: ${failure}`)
    }
    lines.push("", "Event log:", "", "```json", JSON.stringify(fixture.events, null, 2), "```")
  }

  return `${lines.join("\n")}\n`
}
