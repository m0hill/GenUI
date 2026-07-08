import assert from "node:assert/strict"
import { test } from "node:test"
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai"
import type { Surface } from "@hono-ai/genui-runtime"
import { renderToString } from "datastar-kit"
import type { AssistantTurn } from "../../session/chat-session.js"
import { AssistantTurnItem } from "./ui.js"

const generatedSurface: Surface = {
  id: "surface-test",
  dialect: "genui/0",
  html: `<section style="padding: 12px"><h2>Preview UI</h2></section>`,
  grant: { surfaceId: "surface-test", capabilities: [] },
}

const createTurn = (
  state: AssistantTurn["tools"] extends Map<string, infer State> ? State : never,
) => {
  const toolCall = fauxToolCall("create_ui", { html: generatedSurface.html }, { id: "tool-test" })

  return {
    id: "turn-test",
    role: "assistant",
    messages: [fauxAssistantMessage(toolCall)],
    tools: new Map([[toolCall.id, state]]),
    status: "streaming",
  } satisfies AssistantTurn
}

void test("streaming generated UI renders inert preview instead of iframe mount point", () => {
  const html = renderToString(
    AssistantTurnItem({ turn: createTurn({ status: "streaming", surface: generatedSurface }) }),
  )

  assert.match(html, /generated-ui-preview/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /Preview UI/)
  assert.doesNotMatch(html, /data-genui-surface/)
})

void test("complete generated UI renders a runtime mount point", () => {
  const html = renderToString(
    AssistantTurnItem({ turn: createTurn({ status: "complete", surface: generatedSurface }) }),
  )

  assert.match(html, /class="generated-ui"/)
  assert.match(html, /data-genui-surface=/)
  assert.doesNotMatch(html, /generated-ui-preview/)
})
