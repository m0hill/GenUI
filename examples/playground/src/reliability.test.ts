import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { serve } from "@hono/node-server"
import { checkGeneratedInterface, GeneratedInterfaceCheckError } from "@genui/check"
import type { Generation } from "genui"
import { chromium } from "playwright"
import { app, playgroundGeneration, resetPlaygroundState } from "./app.js"
import { resetDemoOrders } from "./actions.js"
import { parseExecuteRequest, parsePlaygroundEvent } from "./playground-codecs.js"
import { reliabilityScenarios } from "./reliability-scenarios.js"

for (const scenario of reliabilityScenarios) {
  void test(scenario.id, async () => {
    const fragment = await readFile(scenario.fragment, "utf8")

    if (scenario.kind === "checker") {
      const checked = await checkGeneratedInterface(playgroundGeneration, { content: fragment })
      const { expected } = scenario
      if (expected.ok) {
        assert.deepEqual(checked, { ok: true })
        return
      }

      assert.equal(checked.ok, false)
      if (checked.ok) throw new Error(`${scenario.id} should produce checker diagnostics.`)
      assert.equal(checked.diagnostics.length, expected.diagnosticCount)
      assert.equal(
        checked.diagnostics.every(({ code }) => code.startsWith(expected.diagnosticPrefix)),
        true,
      )
      for (const text of expected.reportIncludes) assert.match(checked.report, new RegExp(text))
      return
    }

    if (scenario.kind === "operational") {
      const controller = new AbortController()
      const reason = { code: scenario.expected.cancellationReason }
      controller.abort(reason)
      await assert.rejects(
        checkGeneratedInterface(playgroundGeneration, {
          content: fragment,
          signal: controller.signal,
        }),
        (error) => error === reason,
      )

      const counterfeitGeneration = {
        guidance: () => ({ environment: "", capabilityContract: "" }),
        createSurface: async () => {
          throw new Error("not implemented")
        },
      } satisfies Generation
      await assert.rejects(
        checkGeneratedInterface(counterfeitGeneration, { content: fragment }),
        (error: unknown) => {
          assert.ok(error instanceof GeneratedInterfaceCheckError)
          assert.equal(error.code, scenario.expected.incompatibleGenerationCode)
          return true
        },
      )
      return
    }

    assert.deepEqual(await checkGeneratedInterface(playgroundGeneration, { content: fragment }), {
      ok: true,
    })

    resetDemoOrders()
    resetPlaygroundState()
    const browser = await chromium.launch()
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve))
      const address = server.address()
      if (address === null || typeof address === "string") {
        throw new Error("Reliability server did not bind a TCP port.")
      }

      const page = await browser.newPage()
      const actionCalls: Array<{ readonly action: string; readonly input: unknown }> = []
      page.on("request", (request) => {
        if (request.method() !== "POST" || new URL(request.url()).pathname !== "/genui/execute") {
          return
        }
        const parsed = parseExecuteRequest(JSON.parse(request.postData() ?? "null"))
        if (parsed !== undefined) {
          actionCalls.push({ action: parsed.call.action, input: parsed.call.input })
        }
      })

      await page.goto(`http://127.0.0.1:${String(address.port)}`)
      await page.locator("#surface-source").fill(fragment)
      await page.locator("#create-surface").click()

      const frame = page.frameLocator("#surface iframe")
      await frame.locator('#search-orders[data-ready="true"]').waitFor()
      assert.deepEqual(actionCalls, [], "the fragment must wait for user interaction")

      await scenario.interact(page)
      await frame
        .locator(scenario.expected.ui.selector)
        .filter({ hasText: scenario.expected.ui.text })
        .waitFor()

      assert.deepEqual(actionCalls, scenario.expected.actionCalls)
      assert.equal(
        await frame.locator(scenario.expected.ui.selector).textContent(),
        scenario.expected.ui.text,
      )

      const events = (await page.locator("#event-log > li").allTextContents()).map(
        (encoded, index) => {
          const event = parsePlaygroundEvent(JSON.parse(encoded))
          if (event === undefined) {
            throw new Error(`Reliability event ${String(index + 1)} is malformed.`)
          }
          return event
        },
      )
      assert.deepEqual(
        events
          .filter((event) => event.type === "call")
          .map(({ call }) => ({ action: call.action, input: call.input })),
        scenario.expected.actionCalls,
      )
      assert.equal(
        events.some((event) => event.type === "result" && event.result.ok),
        true,
      )
      assert.equal(
        events.some((event) => event.type === "guest_error"),
        false,
      )
      assert.equal(
        events.some((event) => event.type === "violation"),
        false,
      )
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
  })
}
