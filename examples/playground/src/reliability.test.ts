import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { serve } from "@hono/node-server"
import { checkGeneratedInterface, GeneratedInterfaceCheckError } from "@genui/check"
import { Genui, memoryStore, type Generation, type SurfaceStore } from "genui"
import { mount } from "genui/dom"
import {
  maxSurfaceContentBytes,
  parseSurface,
  type ActionResult,
  type SurfaceRecord,
} from "genui/protocol"
import { Window } from "happy-dom"
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
      if (!("diagnosticCodes" in expected)) {
        assert.equal(
          checked.diagnostics.every(({ code }) => code.startsWith(expected.diagnosticPrefix)),
          true,
        )
      } else {
        assert.deepEqual(
          checked.diagnostics.map(({ code }) => code),
          expected.diagnosticCodes,
        )
      }
      for (const text of expected.reportIncludes) assert.match(checked.report, new RegExp(text))
      return
    }

    if (scenario.kind === "bounds") {
      assert.equal(maxSurfaceContentBytes, scenario.expected.maxSurfaceContentBytes)
      assert.equal(
        (fragment.match(/<script type="module">/gu) ?? []).length,
        scenario.expected.maxInlineModules,
      )
      assert.deepEqual(await checkGeneratedInterface(playgroundGeneration, { content: fragment }), {
        ok: true,
      })

      const excessModule = await checkGeneratedInterface(playgroundGeneration, {
        content: `${fragment}\n<script type="module"></script>`,
      })
      assert.equal(excessModule.ok, false)
      if (excessModule.ok) throw new Error("The seventeenth module must be rejected.")
      assert.deepEqual(
        excessModule.diagnostics.map(({ code }) => code),
        [scenario.expected.excessModuleCode],
      )

      const exactContent = `${"界".repeat(Math.floor(maxSurfaceContentBytes / 3))}x`
      const oversizedContent = `${exactContent}界`
      assert.equal(exactContent.length < maxSurfaceContentBytes, true)
      assert.equal(new TextEncoder().encode(exactContent).byteLength, maxSurfaceContentBytes)

      const oversizedCheck = await checkGeneratedInterface(playgroundGeneration, {
        content: oversizedContent,
      })
      assert.equal(oversizedCheck.ok, false)
      if (oversizedCheck.ok) throw new Error("Oversized content must be rejected.")
      assert.deepEqual(
        oversizedCheck.diagnostics.map(({ code }) => code),
        [scenario.expected.oversizedCode],
      )

      const backing = memoryStore()
      let storeWrites = 0
      const countingStore: SurfaceStore = {
        get: (id) => backing.get(id),
        set: (record) => {
          storeWrites += 1
          return backing.set(record)
        },
        revoke: (id) => backing.revoke(id),
        runIdempotent: (request, operation) => backing.runIdempotent(request, operation),
      }
      const runtime = new Genui<undefined>({ actions: [], store: countingStore })
      const generation = runtime.generation({ actions: [] })
      await assert.rejects(
        generation.createSurface({ content: oversizedContent }),
        /Surface content must be at most 102400 UTF-8 bytes/,
      )
      assert.equal(storeWrites, 0)

      const exactSurface = await generation.createSurface({ content: exactContent })
      assert.equal(storeWrites, 1)
      assert.notEqual(parseSurface(exactSurface), undefined)
      assert.equal(parseSurface({ ...exactSurface, content: oversizedContent }), undefined)

      const validRecord = await backing.get(exactSurface.id)
      assert.ok(validRecord)
      const oversizedRecords: readonly SurfaceRecord[] = [
        {
          ...validRecord,
          source: { ...validRecord.source, content: oversizedContent },
        },
        {
          ...validRecord,
          surface: { ...validRecord.surface, content: oversizedContent },
        },
      ]
      for (const record of oversizedRecords) {
        let maliciousWrites = 0
        const maliciousStore: SurfaceStore = {
          get: () => record,
          set: () => {
            maliciousWrites += 1
          },
          revoke: () => undefined,
          runIdempotent: async (_request, operation) => ({
            status: "result",
            result: await operation(),
          }),
        }
        const restored = new Genui<undefined>({ actions: [], store: maliciousStore })
        assert.equal(await restored.diagnostics(record.surface.id), undefined)
        assert.equal(await restored.reproject(record.surface.id), undefined)
        assert.deepEqual(
          await restored.execute(
            {
              surfaceId: record.surface.id,
              callId: "bounds-call",
              action: "bounds.missing",
              input: {},
            },
            undefined,
          ),
          {
            ok: false,
            error: { code: "unknown_surface", message: "Surface is not available." },
          },
        )
        assert.equal(maliciousWrites, 0)
      }

      const window = new Window()
      const root = window.document.createElement("div")
      const existing = window.document.createElement("p")
      existing.textContent = "Existing host content"
      root.append(existing)
      // SAFETY: happy-dom implements the Element operations used by mount in this test.
      const mountRoot = root as unknown as Element
      const transport = async (): Promise<ActionResult> => ({ ok: true, value: null })
      assert.throws(
        () => mount(mountRoot, { ...exactSurface, content: oversizedContent }, { transport }),
        /Surface content must be at most 102400 UTF-8 bytes/,
      )
      assert.equal(root.querySelector("iframe"), null)
      assert.equal(root.textContent, "Existing host content")

      const mounted = mount(mountRoot, { ...exactSurface, content: "<p>Valid</p>" }, { transport })
      const iframe = root.querySelector("iframe")
      assert.ok(iframe)
      const initialDocument = iframe.srcdoc
      assert.throws(
        () => mounted.replace({ ...exactSurface, content: oversizedContent }),
        /Surface content must be at most 102400 UTF-8 bytes/,
      )
      assert.equal(iframe.srcdoc, initialDocument)
      assert.doesNotMatch(iframe.srcdoc, /界/)
      mounted.dispose()
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
