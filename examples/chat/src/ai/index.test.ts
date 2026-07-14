import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux"
import { maxSurfaceContentBytes, type ActionCall } from "genui/protocol"
import { JsonPreferenceStore } from "../preferences.js"
import { JsonlChatSession } from "../session.js"
import {
  generatedInterfaceOutcomeMessage,
  type GeneratedInterfaceAttempt,
  type GeneratedInterfaceRepairOutcome,
} from "./generated-interface-repair.js"
import { executeGeneratedUiAction } from "./genui.js"
import { type ChatStreamEvent, streamChatWithProvider } from "./index.js"

const invalidContent = (marker: string) => `<button id="search">Search</button>
<script type="module">
  // ${marker}
  document.querySelector("#search").onclick = async () => {
    await genui.capabilities.webSearch({ query: "GenUI" })
  }
</script>`

const validContent = `<button id="save">Save</button>
<script type="module">
  document.querySelector("#save").onclick = async () => {
    const saved = await genui.call("preferences.save", { preference: "Mountain escape" })
    document.body.textContent = saved.preference
  }
</script>`

const renderUiArgumentsResponse = (arguments_: Record<string, unknown>, id: string) =>
  fauxAssistantMessage(fauxToolCall("render_ui", arguments_, { id }), {
    stopReason: "toolUse",
  })

const renderUiResponse = (content: unknown, id: string) =>
  renderUiArgumentsResponse({ content }, id)

const collect = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const attempts = (events: readonly ChatStreamEvent[]): GeneratedInterfaceAttempt[] =>
  events.filter(
    (event): event is GeneratedInterfaceAttempt => event.type === "generated_interface_attempt",
  )

const outcomes = (events: readonly ChatStreamEvent[]): GeneratedInterfaceRepairOutcome[] =>
  events.filter(
    (event): event is GeneratedInterfaceRepairOutcome =>
      event.type === "generated_interface_repair_outcome",
  )

const preferenceStore = (context: { after(callback: () => Promise<void>): void }) => {
  const filePath = join(tmpdir(), `genui-chat-preference-${randomUUID()}.json`)
  context.after(() => rm(filePath, { force: true }))
  return new JsonPreferenceStore(filePath)
}

const runFauxChat = async (
  context: { after(callback: () => Promise<void>): void },
  responses: readonly FauxResponseStep[],
  history: Parameters<typeof streamChatWithProvider>[0]["history"] = [],
): Promise<{ readonly events: ChatStreamEvent[]; readonly callCount: number }> => {
  const faux = fauxProvider({ tokensPerSecond: 0 })
  faux.setResponses([...responses])
  const events = await collect(
    await streamChatWithProvider(
      {
        history,
        prompt: "Render an interface.",
        modelContext: undefined,
        preferences: preferenceStore(context),
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    ),
  )
  return { events, callCount: faux.state.callCount }
}

void test("CHAT-REPAIR-001 accepts an initial valid generated interface", async (context) => {
  const { events, callCount } = await runFauxChat(context, [
    renderUiResponse(validContent, "valid-surface"),
    fauxAssistantMessage("The preference interface is ready."),
  ])

  assert.equal(callCount, 2)
  assert.equal(attempts(events).length, 0)
  assert.equal(outcomes(events).length, 0)
  assert.equal(events.filter((event) => event.type === "surface_result").length, 1)
})

void test("CHAT-REPAIR-002 accepts changed valid content after one rejection", async (context) => {
  const faux = fauxProvider({ tokensPerSecond: 0 })
  faux.setResponses([
    renderUiResponse(invalidContent("first-invalid"), "invalid-surface"),
    (providerContext) => {
      const result = providerContext.messages.at(-1)
      assert.equal(result?.role, "toolResult")
      if (result?.role !== "toolResult") throw new Error("Expected a render_ui result.")
      assert.equal(result.toolName, "render_ui")
      assert.equal(result.isError, true)
      const report = result.content[0]
      assert.equal(report?.type, "text")
      if (report?.type !== "text") throw new Error("Expected checker diagnostics as text.")
      assert.match(report.text, /capabilities/)
      assert.equal(report.text.length <= 8_000, true)
      return renderUiResponse(validContent, "corrected-surface")
    },
    fauxAssistantMessage("The preference interface is ready."),
  ])
  const preferences = preferenceStore(context)

  const events = await collect(
    await streamChatWithProvider(
      {
        history: [],
        prompt: "Let me save a trip preference.",
        modelContext: undefined,
        preferences,
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    ),
  )
  const rejection = attempts(events)[0]
  const surfaceEvent = events.find((event) => event.type === "surface_result")

  assert.equal(faux.state.callCount, 3)
  assert(rejection)
  assert.equal(rejection.submission, 1)
  assert.equal("terminal" in rejection, false)
  assert.equal(rejection.evidence.kind, "content")
  assert.match(rejection.diagnostics[0]?.message ?? "", /capabilities/)
  assert.equal(outcomes(events).length, 0)
  assert(surfaceEvent?.type === "surface_result")
  const surface = surfaceEvent.surface
  assert.equal(surface.content, validContent)
  assert.equal(
    surface.grant.actions.some((action) => action.name === "preferences.save"),
    true,
  )

  const call = {
    surfaceId: surface.id,
    callId: "save-from-repaired-surface",
    action: "preferences.save",
    input: { preference: "Mountain escape" },
  } satisfies ActionCall
  assert.deepEqual(await executeGeneratedUiAction(call, preferences, () => true), {
    ok: true,
    value: { preference: "Mountain escape" },
  })
})

void test("CHAT-REPAIR-003 records budget_exhausted on the third rejection", async (context) => {
  const { events, callCount } = await runFauxChat(context, [
    renderUiResponse(invalidContent("invalid-one"), "invalid-one"),
    renderUiResponse(invalidContent("invalid-two"), "invalid-two"),
    renderUiResponse(invalidContent("invalid-three"), "invalid-three"),
  ])

  assert.equal(callCount, 3)
  assert.deepEqual(
    attempts(events).map((attempt) => attempt.submission),
    [1, 2, 3],
  )
  const outcome = outcomes(events)[0]
  assert(outcome)
  assert.equal(outcomes(events).length, 1)
  assert.equal(outcome.submissionCount, 3)
  assert.equal(outcome.reason, "budget_exhausted")
  assert.equal(outcome.diagnosticCodes.length > 0, true)
  assert.equal(
    events.some((event) => event.type === "surface_result"),
    false,
  )
})

void test("CHAT-REPAIR-004 stops repeated normalized invalid content early", async (context) => {
  const repeated = `  ${invalidContent("same-invalid")}  `
  const { events, callCount } = await runFauxChat(context, [
    renderUiResponse(repeated, "invalid-one"),
    renderUiResponse(repeated.trim(), "invalid-two"),
  ])

  assert.equal(callCount, 2)
  assert.deepEqual(
    attempts(events).map((attempt) => attempt.submission),
    [1, 2],
  )
  assert.equal(outcomes(events)[0]?.reason, "repeated_content")
  assert.equal(outcomes(events)[0]?.submissionCount, 2)
})

void test("CHAT-REPAIR-005 records model_stopped without forcing another call", async (context) => {
  const { events, callCount } = await runFauxChat(context, [
    renderUiResponse(invalidContent("abandoned"), "invalid-one"),
    fauxAssistantMessage("I could not finish the interface."),
  ])

  assert.equal(callCount, 2)
  assert.equal(attempts(events).length, 1)
  assert.equal(outcomes(events)[0]?.reason, "model_stopped")
  assert.equal(outcomes(events)[0]?.submissionCount, 1)
})

void test("other tool calls do not consume the generated-interface budget", async (context) => {
  const otherTools = fauxAssistantMessage(
    [
      fauxToolCall("web_search", {}, { id: "invalid-search" }),
      fauxToolCall("preferences_get", {}, { id: "read-preference" }),
    ],
    { stopReason: "toolUse" },
  )
  const { events, callCount } = await runFauxChat(context, [
    otherTools,
    renderUiResponse(invalidContent("after-other-tools"), "invalid-interface"),
    fauxAssistantMessage("Stopped."),
  ])

  assert.equal(callCount, 3)
  assert.deepEqual(
    attempts(events).map((attempt) => attempt.submission),
    [1],
  )
})

void test("CHAT-REPAIR-006 counts and bounds every malformed or unsupported submission", async (context) => {
  const oversizedContent = "界".repeat(Math.floor(maxSurfaceContentBytes / 3) + 1)
  const tooManyModules = Array.from(
    { length: 17 },
    (_, index) => `<script type="module">document.body.dataset.m${String(index)} = "1"</script>`,
  ).join("\n")
  const cases = [
    {
      name: "missing content",
      arguments: {},
      evidenceKind: "malformed",
      code: "CHAT_UI001",
    },
    {
      name: "non-string content",
      arguments: { content: null },
      evidenceKind: "malformed",
      code: "CHAT_UI001",
    },
    {
      name: "empty content",
      arguments: { content: "  " },
      evidenceKind: "content",
      code: "CHAT_UI002",
    },
    {
      name: "oversized UTF-8 content",
      arguments: { content: oversizedContent },
      evidenceKind: "oversized",
      code: "GENUI004",
    },
    {
      name: "too many modules",
      arguments: { content: tooManyModules },
      evidenceKind: "content",
      code: "GENUI005",
    },
    {
      name: "external script",
      arguments: { content: '<script type="module" src="/guest.js"></script>' },
      evidenceKind: "content",
      code: "GENUI001",
    },
  ] as const

  for (const scenario of cases) {
    await context.test(scenario.name, async (subtest) => {
      const faux = fauxProvider({ tokensPerSecond: 0 })
      faux.setResponses([
        renderUiArgumentsResponse(scenario.arguments, `invalid-${scenario.code}`),
        (providerContext) => {
          const result = providerContext.messages.at(-1)
          assert.equal(result?.role, "toolResult")
          if (result?.role !== "toolResult") throw new Error("Expected a render_ui result.")
          assert.equal(result.isError, true)
          const report = result.content[0]
          assert.equal(report?.type, "text")
          if (report?.type !== "text") throw new Error("Expected a bounded error result.")
          assert.match(report.text, new RegExp(scenario.code))
          assert.equal(report.text.length <= 8_000, true)
          return fauxAssistantMessage("No interface was produced.")
        },
      ])
      const events = await collect(
        await streamChatWithProvider(
          {
            history: [],
            prompt: "Render an interface.",
            modelContext: undefined,
            preferences: preferenceStore(subtest),
            signal: new AbortController().signal,
          },
          faux.provider,
          faux.getModel(),
          "test-key",
        ),
      )
      const attempt = attempts(events)[0]
      assert(attempt)
      assert.equal(attempt.submission, 1)
      assert.equal(attempt.evidence.kind, scenario.evidenceKind)
      assert.equal(
        attempt.diagnostics.some(({ code }) => code === scenario.code),
        true,
      )
      assert.equal(outcomes(events)[0]?.reason, "model_stopped")
      if (scenario.evidenceKind !== "content") {
        assert.equal("content" in attempt.evidence, false)
      }
    })
  }
})

void test("CHAT-REPAIR-007 cancellation and operational failures do not repair", async (context) => {
  await context.test("cancellation preserves its reason", async (subtest) => {
    const faux = fauxProvider({ tokensPerSecond: 0 })
    faux.setResponses([renderUiResponse(validContent, "cancelled-surface")])
    const controller = new AbortController()
    const reason = new Error("request disconnected")
    const events: ChatStreamEvent[] = []
    const stream = await streamChatWithProvider(
      {
        history: [],
        prompt: "Render an interface.",
        modelContext: undefined,
        preferences: preferenceStore(subtest),
        signal: controller.signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    )

    await assert.rejects(
      async () => {
        for await (const event of stream) {
          events.push(event)
          if (event.type === "toolcall_end") controller.abort(reason)
        }
      },
      (error) => error === reason,
    )
    assert.equal(faux.state.callCount, 1)
    assert.equal(attempts(events).length, 0)
  })

  await context.test("provider failure does not produce a repair outcome", async (subtest) => {
    const faux = fauxProvider({ tokensPerSecond: 0 })
    faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "PRIVATE_PROVIDER_FAILURE",
      }),
    ])
    const events: ChatStreamEvent[] = []
    const stream = await streamChatWithProvider(
      {
        history: [],
        prompt: "Render an interface.",
        modelContext: undefined,
        preferences: preferenceStore(subtest),
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    )
    await assert.rejects(async () => {
      for await (const event of stream) events.push(event)
    }, /completed response/)
    assert.equal(faux.state.callCount, 1)
    assert.equal(attempts(events).length, 0)
    assert.equal(outcomes(events).length, 0)
  })

  await context.test("storage failure stops before another provider call", async (subtest) => {
    const directory = await mkdtemp(join(tmpdir(), "genui-chat-storage-failure-"))
    const session = await JsonlChatSession.open(join(directory, "chat.jsonl"))
    await rm(directory, { recursive: true, force: true })
    const faux = fauxProvider({ tokensPerSecond: 0 })
    faux.setResponses([
      renderUiResponse(invalidContent("storage-failure"), "invalid-one"),
      fauxAssistantMessage("This response must not run."),
    ])
    const stream = await streamChatWithProvider(
      {
        history: [],
        prompt: "Render an interface.",
        modelContext: undefined,
        preferences: preferenceStore(subtest),
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    )

    await assert.rejects(async () => {
      for await (const event of stream) {
        if (event.type === "generated_interface_attempt") {
          await session.appendGeneratedInterfaceAttempt({
            turnId: "turn-storage-failure",
            submission: event.submission,
            evidence: event.evidence,
            diagnostics: event.diagnostics,
          })
        }
      }
    })
    assert.equal(faux.state.callCount, 1)
  })
})

void test("CHAT-HISTORY-008 excludes repair evidence from restored and future history", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-history-"))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, "chat.jsonl")
  const session = await JsonlChatSession.open(filePath)
  const privateMarker = "PRIVATE_REJECTED_GENERATED_SOURCE"
  const first = await runFauxChat(context, [
    renderUiResponse(invalidContent(privateMarker), "invalid-one"),
    fauxAssistantMessage("I could not finish the interface."),
  ])

  for (const event of first.events) {
    if (event.type === "generated_interface_attempt") {
      await session.appendGeneratedInterfaceAttempt({
        turnId: "turn-history",
        submission: event.submission,
        evidence: event.evidence,
        diagnostics: event.diagnostics,
      })
    } else if (event.type === "generated_interface_repair_outcome") {
      await session.appendGeneratedInterfaceRepairOutcome({
        turnId: "turn-history",
        submissionCount: event.submissionCount,
        reason: event.reason,
        diagnosticCodes: event.diagnosticCodes,
      })
    }
  }
  await session.appendTurn({
    userId: "user-history",
    assistantId: "assistant-history",
    prompt: "Render an interface.",
    assistantContent: [{ type: "text", text: "I could not finish the interface." }],
  })

  const restored = await JsonlChatSession.open(filePath)
  assert.deepEqual(restored.getHistory(), [
    { role: "user", content: "Render an interface." },
    {
      role: "assistant",
      content: [{ type: "text", text: "I could not finish the interface." }],
    },
  ])
  const persisted = await readFile(filePath, "utf8")
  assert.match(persisted, new RegExp(privateMarker))

  const faux = fauxProvider({ tokensPerSecond: 0 })
  faux.setResponses([
    (providerContext) => {
      const modelInput = JSON.stringify(providerContext.messages)
      assert.doesNotMatch(modelInput, new RegExp(privateMarker))
      assert.doesNotMatch(modelInput, /generated_interface_(attempt|repair_outcome)/)
      assert.doesNotMatch(modelInput, /TS2339/)
      return fauxAssistantMessage("History remained clean.")
    },
  ])
  await collect(
    await streamChatWithProvider(
      {
        history: restored.getHistory(),
        prompt: "Continue.",
        modelContext: undefined,
        preferences: preferenceStore(context),
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    ),
  )
  assert.equal(faux.state.callCount, 1)
})

void test("trusted repair outcome summaries are fixed and bounded", () => {
  assert.deepEqual(
    ["budget_exhausted", "repeated_content", "model_stopped"].map((reason) =>
      generatedInterfaceOutcomeMessage(reason as GeneratedInterfaceRepairOutcome["reason"]),
    ),
    [
      "No valid generated interface was produced after three submissions.",
      "The generated interface repeated invalid content, so repair stopped.",
      "The model stopped before producing a valid generated interface.",
    ],
  )
})
