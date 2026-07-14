import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { ActionCall } from "genui/protocol"
import { JsonPreferenceStore } from "../preferences.js"
import { executeGeneratedUiAction } from "./genui.js"
import { type ChatStreamEvent, streamChatWithProvider } from "./index.js"

const invalidContent = `<button id="search">Search</button>
<script type="module">
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

const renderUiResponse = (content: string, id: string) =>
  fauxAssistantMessage(fauxToolCall("render_ui", { content }, { id }), {
    stopReason: "toolUse",
  })

const collect = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const preferenceStore = (context: { after(callback: () => Promise<void>): void }) => {
  const filePath = join(tmpdir(), `genui-chat-preference-${randomUUID()}.json`)
  context.after(() => rm(filePath, { force: true }))
  return new JsonPreferenceStore(filePath)
}

void test("chat repairs an invalid generated interface before emitting a surface", async (context) => {
  const faux = fauxProvider({ tokensPerSecond: 0 })
  faux.setResponses([
    renderUiResponse(invalidContent, "invalid-surface"),
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
  const surfaces = events.flatMap((event) =>
    event.type === "surface_result" ? [event.surface] : [],
  )

  assert.equal(faux.state.callCount, 3)
  assert.equal(surfaces.length, 1)
  const surface = surfaces[0]
  assert(surface)
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

void test("chat stops after a bounded number of invalid generated interfaces", async (context) => {
  const marker = "PRIVATE_GENERATED_MARKER"
  const terminalContent = `<script type="module">genui.${marker}()</script>`
  const faux = fauxProvider({ tokensPerSecond: 0 })
  faux.setResponses([
    renderUiResponse(terminalContent, "invalid-one"),
    renderUiResponse(terminalContent, "invalid-two"),
  ])
  const events: ChatStreamEvent[] = []
  const stream = await streamChatWithProvider(
    {
      history: [],
      prompt: "Render an interface.",
      modelContext: undefined,
      preferences: preferenceStore(context),
      signal: new AbortController().signal,
    },
    faux.provider,
    faux.getModel(),
    "test-key",
  )

  await assert.rejects(
    async () => {
      for await (const event of stream) events.push(event)
    },
    (error) => {
      assert(error instanceof Error)
      assert.equal(
        error.message,
        "The model could not produce a valid generated interface after 2 attempts.",
      )
      assert.doesNotMatch(error.message, new RegExp(marker))
      return true
    },
  )

  assert.equal(faux.state.callCount, 2)
  assert.equal(
    events.some((event) => event.type === "surface_result"),
    false,
  )
})

void test("chat cancellation stops generated-interface checking before surface creation", async (context) => {
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
      preferences: preferenceStore(context),
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
  assert.equal(
    events.some((event) => event.type === "surface_result"),
    false,
  )
})
