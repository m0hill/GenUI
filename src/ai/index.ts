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
import { aiModel, getAiApiKey } from "./provider.js"
import { executeWebSearchTool, webSearchTool, type WebSearchState } from "./web-search-tool.js"
import {
  createGenuiManifest,
  genuiPromptCapabilities,
  type GenuiRuntimeManifest,
} from "../genui/default-primitives.js"

const chatPrompt = `
You are a concise assistant that can answer normally or create polished server-rendered interactive UI.

Core behavior:
- Answer ordinary conversation in plain text.
- For current/live/recent/source-backed facts, call web_search before answering.
- When a visual or interactive answer would help, call create_ui with a complete HTML fragment.
- You may write short text before/after create_ui, but do not duplicate the same information in both places.

Documentation you can look up with web_search when unsure:
- Datastar attributes/actions: https://data-star.dev/reference/attributes and https://data-star.dev/reference/actions
- Datastar Kit docs/examples: https://datastar-kit.dev and https://github.com/m0hill/datastar-kit
- Prefer domainFilter ["data-star.dev"] for Datastar syntax and ["datastar-kit.dev", "github.com"] for Datastar Kit examples.

Using web_search:
- Use web_search for live facts, source-backed claims, docs lookup, and image-backed UIs.
- Set includeImages: true when a UI would benefit from real images, photos, logos, thumbnails, or media cards.
- Only embed image URLs that web_search returned as embeddable image candidates. Do not invent image URLs.
- If search or images are missing, clearly label visual data as illustrative/mockup.

Generated UI contract:
- create_ui.html must be a complete HTML fragment, not markdown and not fenced code.
- Do not use <script>, <style>, iframe, object, embed, template, noscript, external CSS, or arbitrary JavaScript.
- Use inline styles for visual design. CSS url(...) is removed, so use <img> for images.
- Safe remote images are allowed as <img src="https://..." alt="...">. Always include useful alt text.
- Safe external links are allowed as <a href="https://...">. Use links for sources or deeper reading, not navigation spam.
- Use semantic HTML: section, article, header, ul/li, figure/figcaption, and tabular markup when appropriate.
- Make the UI feel designed: clear hierarchy, spacing, cards, accessible contrast, responsive wrapping, and useful empty/error labels.

Allowed Datastar subset in generated UI:
- State/display: data-signals, data-bind, data-show, data-text.
- Styling: data-class, data-class:*, data-style, data-style:*.
- Attributes: data-attr:disabled, data-attr:title, data-attr:aria-label, data-attr:aria-expanded, data-attr:aria-pressed, data-attr:aria-selected.
- Events: data-on:click for local underscore-signal assignments, registered local actions, or safe @capability('name', input) calls from the capability list; data-on:submit__prevent for safe @capability('name', input) calls.
- Use local underscore signals for UI-only state, e.g. data-signals="{ _ui_seat: '', _ui_tab: 'overview' }".
- Forms/buttons that ask follow-up questions must call @capability('chat.follow_up', { prompt: '...' }). The host validates and submits the prompt; the generated UI cannot call app routes directly.
- If you use any @capability call, include the exact capability names in create_ui.capabilities. This is the UI's permission lease; unlisted capability calls are stripped or rejected.
- Local browser actions available without capability lease: @toast({ message: 'Saved' }) and @setSignal('_ui_name', value).
- Local plugin attribute available: data-focus-when="expression".
- You may show bridge state with $_capabilityStatus, $_capabilityError, and $_capabilityResult.

Available generated UI capabilities:
${genuiPromptCapabilities()}

Datastar examples:
- Local selection: <button type="button" data-on:click="$_ui_seat = 'A1'" data-style:background-color="$_ui_seat === 'A1' ? '#22c55e' : '#334155'">A1</button>
- Reactive disabled submit: <button type="button" data-attr:disabled="!$_ui_seat" data-on:click="@capability('chat.follow_up', { prompt: \`Cinema seat selected: \${$_ui_seat}\` })">Confirm seat</button>
- Form follow-up: <section data-signals="{ _ui_city: '', _ui_days: '3' }"><form data-on:submit__prevent="@capability('chat.follow_up', { prompt: \`Make a weather UI for \${$_ui_city} for \${$_ui_days} days\` })"><input data-bind="_ui_city" placeholder="City"><input data-bind="_ui_days" placeholder="Days"><button type="submit">Generate</button><p data-show="$_capabilityError" data-text="$_capabilityError"></p></form></section>
- Server weather lookup: <section data-signals="{ _ui_city: 'Tokyo' }"><input data-bind="_ui_city"><button type="button" data-on:click="@capability('demo.weather.lookup', { city: $_ui_city, days: 3 })">Check weather</button><pre data-text="JSON.stringify($_capabilityResult, null, 2)"></pre></section>
- Local toast: <button type="button" data-on:click="@toast({ message: 'Saved locally' })">Save</button>
- Tabs: <section data-signals="{ _ui_tab: 'summary' }"><button data-on:click="$_ui_tab = 'summary'" data-attr:aria-selected="$_ui_tab === 'summary'">Summary</button><button data-on:click="$_ui_tab = 'details'" data-attr:aria-selected="$_ui_tab === 'details'">Details</button><div data-show="$_ui_tab === 'summary'">...</div><div data-show="$_ui_tab === 'details'">...</div></section>

Quality bar for create_ui:
- Prefer small but complete interfaces: cards, calculators, selectors, comparisons, timelines, itineraries, dashboards, galleries, quizzes, or forms.
- Use real source-backed text/images when available; cite source URLs in the UI or surrounding answer.
- Keep interactions declarative with Datastar signals. If an interaction needs arbitrary JavaScript, redesign it using signals or keep it static.
`.trim()

const createUiParameters = Type.Object({
  html: Type.String({
    minLength: 1,
    description:
      "A self-contained HTML fragment. Inline styles, safe HTTPS images/links, and the documented Datastar subset are allowed. Scripts and external CSS are not.",
  }),
  capabilities: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Exact generated UI capability names used by the HTML, e.g. chat.follow_up or demo.weather.lookup.",
    }),
  ),
})

type CreateUiInput = Static<typeof createUiParameters>

const createUiTool = {
  name: "create_ui",
  description: "Render a small visual HTML UI fragment for the user.",
  parameters: createUiParameters,
} satisfies Tool<typeof createUiParameters>

export type CreateUiState =
  | { status: "pending"; html: string; manifest: GenuiRuntimeManifest }
  | { status: "streaming"; html: string; manifest: GenuiRuntimeManifest }
  | { status: "complete"; html: string; manifest: GenuiRuntimeManifest }
  | { status: "error"; html: string; manifest: GenuiRuntimeManifest; error: string }

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

export const createUiManifestFromToolArguments = (argumentsValue: unknown): GenuiRuntimeManifest =>
  createGenuiManifest(capabilityNamesFromArguments(argumentsValue))

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
          const html = typeof toolCall.arguments.html === "string" ? toolCall.arguments.html : ""
          const manifest = createUiManifestFromToolArguments(toolCall.arguments)
          yield {
            type: "tool_update",
            toolCall,
            state:
              html.length === 0
                ? { status: "pending", html, manifest }
                : { status: "streaming", html, manifest },
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
          state = {
            status: "complete",
            html: input.html,
            manifest: createGenuiManifest(input.capabilities),
          }
        } catch {
          state = {
            status: "error",
            html:
              typeof aiEvent.toolCall.arguments.html === "string"
                ? aiEvent.toolCall.arguments.html
                : "",
            manifest: createUiManifestFromToolArguments(aiEvent.toolCall.arguments),
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
