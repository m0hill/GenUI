import {
  stream as streamAssistant,
  Type,
  validateToolArguments,
  type AssistantMessage,
  type Message,
  type Static,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
} from "@earendil-works/pi-ai"
import type { Surface } from "@hono-ai/genui-runtime"
import { aiModel, getAiApiKey } from "./provider.js"
import { executeWebSearchTool, webSearchTool, type WebSearchState } from "./web-search-tool.js"
import { createGeneratedSurface, genuiPromptCapabilities } from "../genui/default-primitives.js"

const chatPrompt = `
You are a concise assistant that can answer normally or create polished server-rendered interactive UI.

Core behavior:
- Answer ordinary conversation in plain text.
- For current/live/recent/source-backed facts, call web_search before answering.
- When a visual or interactive answer would help, call create_ui with a complete HTML fragment.
- You may write short text before/after create_ui, but do not duplicate the same information in both places.

Using web_search:
- Use web_search for live facts, source-backed claims, docs lookup, and image-backed UIs.
- Set includeImages: true when a UI would benefit from real images, photos, logos, thumbnails, or media cards.
- Only embed image URLs that web_search returned as embeddable image candidates. Do not invent image URLs.
- If search or images are missing, clearly label visual data as illustrative/mockup.

Generated UI contract:
- create_ui.html must be a complete HTML fragment, not markdown and not fenced code.
- Do not use <script>, <style>, iframe, object, embed, template, noscript, external CSS, or arbitrary JavaScript.
- Safe remote images are allowed as <img src="https://..." alt="...">. Always include useful alt text.
- Safe external links are allowed as <a href="https://...">. Use links for sources or deeper reading, not navigation spam.
- Use semantic HTML: section, article, header, ul/li, figure/figcaption, and tabular markup when appropriate.
- Make the UI feel designed: clear hierarchy, spacing, cards, accessible contrast, responsive wrapping, and useful empty/error labels.

Generated UI runtime instructions:
${genuiPromptCapabilities()}

GenUI examples:
- Local tabs: <section data-genui-state="{ tab: 'summary' }"><button type="button" data-genui-on-click="@set('tab', 'summary')" data-genui-attr-aria-selected="$tab == 'summary'">Summary</button><button type="button" data-genui-on-click="@set('tab', 'details')" data-genui-attr-aria-selected="$tab == 'details'">Details</button><div data-genui-show="$tab == 'summary'">...</div><div data-genui-show="$tab == 'details'">...</div></section>
- Follow-up form: <section data-genui-state="{ city: '', days: 3 }"><form data-genui-on-submit="@capability('chat.follow_up', { prompt: $city })"><input data-genui-bind="city" placeholder="City"><button type="submit">Ask</button><p data-genui-show="$chatFollowUp.status == 'error'" data-genui-text="$chatFollowUp.error"></p></form></section>
- Server weather lookup: <section data-genui-state="{ city: 'Tokyo' }"><input data-genui-bind="city"><button type="button" data-genui-on-click="@capability('demo.weather.lookup', { city: $city, days: 3 }, { target: 'weather' })">Check weather</button><p data-genui-show="$weather.status == 'pending'">Loading...</p><pre data-genui-text="$weather.value"></pre></section>
- Lists: <section><button type="button" data-genui-on-click="@capability('demo.notes.list', { limit: 5 }, { target: 'notes' })">Load notes</button><ul data-genui-each="$notes.value.notes" data-genui-as="note"><li data-genui-text="$note.text"></li></ul></section>

Quality bar for create_ui:
- Prefer small but complete interfaces: cards, calculators, selectors, comparisons, timelines, itineraries, dashboards, galleries, quizzes, or forms.
- Use real source-backed text/images when available; cite source URLs in the UI or surrounding answer.
- Keep interactions declarative with GenUI state. If an interaction needs arbitrary JavaScript, redesign it with data-genui-* directives or keep it static.
`.trim()

const createUiParameters = Type.Object({
  capabilities: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Exact generated UI capability names used by the HTML, e.g. chat.follow_up or demo.weather.lookup.",
    }),
  ),
  html: Type.String({
    minLength: 1,
    description:
      "A self-contained HTML fragment using the documented data-genui-* runtime dialect. Scripts and external CSS are not allowed.",
  }),
})

type CreateUiInput = Static<typeof createUiParameters>

const createUiTool = {
  name: "create_ui",
  description: "Render a small visual HTML UI fragment for the user.",
  parameters: createUiParameters,
} satisfies Tool<typeof createUiParameters>

export type CreateUiState =
  | { status: "pending"; surface?: undefined }
  | { status: "streaming"; surface: Surface }
  | { status: "complete"; surface: Surface }
  | { status: "error"; surface?: Surface; error: string }

export type AssistantToolState = CreateUiState | WebSearchState

type StreamAiOptions = { sessionId: string; signal: AbortSignal }

type StreamAiTurnUpdate =
  | { type: "assistant_update"; messageIndex: number; message: AssistantMessage }
  | { type: "tool_update"; toolCall: ToolCall; state: AssistantToolState }

const capabilityNamesFromArguments = (argumentsValue: unknown): string[] | undefined => {
  if (typeof argumentsValue !== "object" || argumentsValue === null) return undefined
  const capabilities = (argumentsValue as { readonly capabilities?: unknown }).capabilities
  if (!Array.isArray(capabilities)) return undefined

  const names = capabilities.filter(
    (capability): capability is string => typeof capability === "string",
  )
  return names.length > 0 ? names : undefined
}

export const createUiSurfaceFromToolArguments = async (
  toolCall: Pick<ToolCall, "id" | "arguments">,
  sessionId: string,
): Promise<Surface | undefined> => {
  const html = typeof toolCall.arguments.html === "string" ? toolCall.arguments.html : ""
  if (html.length === 0) return undefined

  return createGeneratedSurface({
    chatId: sessionId,
    toolCallId: toolCall.id,
    html,
    requested: capabilityNamesFromArguments(toolCall.arguments),
  })
}

export async function* streamAiTurn(
  messages: Message[],
  options: StreamAiOptions,
): AsyncGenerator<StreamAiTurnUpdate> {
  let messageIndex = 0

  while (true) {
    const toolResults: ToolResultMessage[] = []
    const responseStream = streamAssistant(
      aiModel,
      { systemPrompt: chatPrompt, messages, tools: [createUiTool, webSearchTool] },
      {
        apiKey: await getAiApiKey(),
        reasoningEffort: "low",
        reasoningSummary: "auto",
        sessionId: options.sessionId,
        signal: options.signal,
        transport: "sse",
      },
    )

    for await (const aiEvent of responseStream) {
      if ("partial" in aiEvent) {
        yield { type: "assistant_update", messageIndex, message: aiEvent.partial }
      }

      if (aiEvent.type === "toolcall_start" || aiEvent.type === "toolcall_delta") {
        const toolCall = aiEvent.partial.content[aiEvent.contentIndex]
        if (toolCall?.type === "toolCall" && toolCall.name === createUiTool.name) {
          const surface = await createUiSurfaceFromToolArguments(toolCall, options.sessionId)
          yield {
            type: "tool_update",
            toolCall,
            state: surface === undefined ? { status: "pending" } : { status: "streaming", surface },
          }
        }

        if (toolCall?.type === "toolCall" && toolCall.name === webSearchTool.name) {
          const query =
            typeof toolCall.arguments.query === "string" ? toolCall.arguments.query.trim() : ""
          yield { type: "tool_update", toolCall, state: { status: "pending", query } }
        }
      }

      if (aiEvent.type === "toolcall_end" && aiEvent.toolCall.name === createUiTool.name) {
        let state: CreateUiState
        try {
          const input: CreateUiInput = validateToolArguments(createUiTool, aiEvent.toolCall)
          const surface = await createGeneratedSurface({
            chatId: options.sessionId,
            toolCallId: aiEvent.toolCall.id,
            html: input.html,
            requested: input.capabilities,
          })
          state = {
            status: "complete",
            surface,
          }
        } catch {
          const surface = await createUiSurfaceFromToolArguments(
            aiEvent.toolCall,
            options.sessionId,
          )
          state = {
            status: "error",
            ...(surface === undefined ? {} : { surface }),
            error: "The model called create_ui with invalid arguments.",
          }
        }

        toolResults.push({
          role: "toolResult",
          toolCallId: aiEvent.toolCall.id,
          toolName: aiEvent.toolCall.name,
          content: [
            {
              type: "text",
              text:
                state.status === "error" ? state.error : "Rendered the requested UI for the user.",
            },
          ],
          isError: state.status === "error",
          timestamp: Date.now(),
        })
        yield { type: "tool_update", toolCall: aiEvent.toolCall, state }
      }

      if (aiEvent.type === "toolcall_end" && aiEvent.toolCall.name === webSearchTool.name) {
        const query =
          typeof aiEvent.toolCall.arguments.query === "string"
            ? aiEvent.toolCall.arguments.query.trim()
            : ""
        yield {
          type: "tool_update",
          toolCall: aiEvent.toolCall,
          state: { status: "searching", query },
        }

        const result = await executeWebSearchTool(aiEvent.toolCall, options.signal)
        const details = result.details ?? { query }
        toolResults.push(result)
        yield {
          type: "tool_update",
          toolCall: aiEvent.toolCall,
          state: result.isError
            ? {
                status: "error",
                query: details.query,
                error: details.error ?? "Web search failed.",
              }
            : {
                status: "complete",
                query: details.query,
                summary: details.summary ?? "",
              },
        }
      }
    }

    const response = await responseStream.result()
    yield { type: "assistant_update", messageIndex, message: response }
    messages.push(response, ...toolResults)

    if (response.stopReason !== "toolUse" || toolResults.length === 0) return
    messageIndex += 1
  }
}
