import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai"
import {
  js,
  mod,
  post,
  preserve,
  regex,
  state as signalState,
  unsafeHtml,
  type HtmlChild,
} from "datastar-kit"
import type { CreateUiState } from "../../ai/index.js"
import type { WebSearchState } from "../../ai/web-search-tool.js"
import { createGenuiManifest } from "../../genui/default-primitives.js"
import { Icons } from "../../ui/icons.js"
import type { AssistantTurn, UserChatMessage } from "../../session/chat-session.js"
import { renderGeneratedUiSandboxDocument } from "./generated-ui-sandbox.js"
import { renderMarkdown } from "./markdown.js"

export const chatForm = signalState({
  chatId: "",
  prompt: "",
  error: "",
  _sending: false,
  _generating: false,
})

const EmptyState = () => (
  <li id="empty-state" class="max-w-md text-fg-muted">
    Ask a normal question, or ask for a tiny interface like “make a minimalist weather card for San
    Francisco”.
  </li>
)

export const MessagesList = (props: {
  messages: ReadonlyArray<UserChatMessage | AssistantTurn>
}) => (
  <ol id="messages" class="flex flex-col gap-8">
    {props.messages.length === 0 ? (
      <EmptyState />
    ) : (
      props.messages.map((message) =>
        message.role === "user" ? (
          <UserMessageItem message={message} />
        ) : (
          <AssistantTurnItem turn={message} />
        ),
      )
    )}
  </ol>
)

export const UserMessageItem = (props: { message: UserChatMessage }) => (
  <li id={props.message.id} class="message flex justify-end">
    <div class="user-bubble">{props.message.text}</div>
  </li>
)

const AssistantText = (props: { text: string }) =>
  props.text.trim().length === 0 ? null : (
    <div class="prose">{unsafeHtml(renderMarkdown(props.text))}</div>
  )

const AssistantThinking = (props: { text: string }) =>
  props.text.trim().length === 0 ? null : (
    <details class="thinking-trace" open data-preserve-attr={preserve("open")}>
      <summary>
        <Icons.chevron aria-hidden="true" class="chevron h-3.5 w-3.5 shrink-0" />
        Thinking
      </summary>
      <div class="thinking-text">{unsafeHtml(renderMarkdown(props.text))}</div>
    </details>
  )

const pendingCreateUiState: CreateUiState = {
  status: "pending",
  html: "",
  manifest: createGenuiManifest(undefined),
}

const chatBusy = js<boolean>`(${chatForm.refs._sending} || ${chatForm.refs._generating})`

const CreateUiToolView = (props: { toolCall: ToolCall; state: CreateUiState | undefined }) => {
  const state = props.state ?? pendingCreateUiState

  return (
    <div
      id={`tool-${props.toolCall.id}`}
      class={`tool-card create-ui ${state.status}`}
      data-scroll-into-view
    >
      {state.status === "pending" ? <small class="message-status">Planning UI</small> : null}
      {state.status === "streaming" && state.html.length === 0 ? (
        <small class="message-status">Designing UI</small>
      ) : null}
      {state.html.length > 0 ? (
        <div
          class="generated-ui"
          data-attr:inert={chatBusy}
          data-style:pointer-events={js`${chatBusy} ? 'none' : 'auto'`}
          data-style:opacity={js`${chatBusy} ? '0.62' : '1'`}
        >
          <iframe
            class="generated-ui-frame"
            data-generated-ui-frame
            data-genui-manifest={JSON.stringify(state.manifest)}
            title="Generated interactive UI"
            sandbox="allow-scripts"
            srcdoc={renderGeneratedUiSandboxDocument(state.html, state.manifest)}
          ></iframe>
        </div>
      ) : null}
      {state.status === "error" ? (
        <small class="error-text">{state.error ?? "Could not build the UI."}</small>
      ) : null}
    </div>
  )
}

const pendingWebSearchState: WebSearchState = { status: "pending", query: "" }

const WebSearchToolView = (props: { toolCall: ToolCall; state: WebSearchState | undefined }) => {
  const state = props.state ?? pendingWebSearchState
  const label =
    state.status === "complete"
      ? "Web search complete"
      : state.status === "error"
        ? "Web search failed"
        : "Searching the web"

  const statusLine = (
    <>
      <Icons.search role="img" aria-label={label} class="search-icon h-4 w-4 shrink-0" />
      {state.query ? <span class="normal-case text-fg-secondary">{state.query}</span> : null}
    </>
  )

  return (
    <div
      id={`tool-${props.toolCall.id}`}
      class={`tool-card web-search ${state.status}`}
      data-scroll-into-view
    >
      {state.status === "complete" ? (
        <details class="search-summary" data-preserve-attr={preserve("open")}>
          <summary class="message-status">
            {statusLine}
            <Icons.chevron aria-hidden="true" class="chevron h-3.5 w-3.5 shrink-0" />
          </summary>
          <pre>{state.summary}</pre>
        </details>
      ) : (
        <small class="message-status">{statusLine}</small>
      )}
      {state.status === "error" ? <small class="error-text">{state.error}</small> : null}
    </div>
  )
}

const AssistantContent = (props: { message: AssistantMessage; turn: AssistantTurn }) => (
  <>
    {props.message.content.map((content): HtmlChild => {
      if (content.type === "text") return <AssistantText text={content.text} />
      if (content.type === "thinking") return <AssistantThinking text={content.thinking} />
      if (content.type === "toolCall" && content.name === "create_ui") {
        const state = props.turn.tools.get(content.id)
        return (
          <CreateUiToolView
            toolCall={content}
            state={state && "html" in state ? state : undefined}
          />
        )
      }
      if (content.type === "toolCall" && content.name === "web_search") {
        const state = props.turn.tools.get(content.id)
        return (
          <WebSearchToolView
            toolCall={content}
            state={state && "query" in state ? state : undefined}
          />
        )
      }
      return null
    })}
  </>
)

const turnStatusText = (turn: AssistantTurn): string => {
  if (turn.status !== "streaming") return ""
  const activeTool = [...turn.tools.values()].find(
    (tool) => tool.status === "streaming" || tool.status === "searching",
  )
  if (activeTool?.status === "streaming") return "Building UI…"
  if (activeTool?.status === "searching") return "Searching web…"
  return turn.messages.length === 0 ? "Thinking…" : "Writing…"
}

export const AssistantTurnItem = (props: { turn: AssistantTurn }) => (
  <li id={props.turn.id} class="message">
    <p class="manual-kicker mb-3">Assistant</p>
    <div class="flex flex-col gap-4">
      {props.turn.messages.map((message) => (
        <AssistantContent message={message} turn={props.turn} />
      ))}
      {props.turn.status === "streaming" ? (
        <small class="message-status">{turnStatusText(props.turn)}</small>
      ) : null}
      {props.turn.status === "error" ? <small class="error-text">{props.turn.error}</small> : null}
    </div>
  </li>
)

export const ComposerBar = () => (
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-linear-to-t from-bg via-bg/92 to-transparent pt-14 pb-5">
    <form
      class="shell pointer-events-auto"
      data-chat-composer-form
      data-indicator={chatForm.refs._sending}
      data-on:submit={mod(
        post("/chat", { filterSignals: { include: regex("^(chatId|prompt)$") } }),
        { prevent: true },
      )}
    >
      <div class="composer">
        <textarea
          class="max-h-48 min-h-7 w-full resize-none self-center bg-transparent py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted"
          rows={1}
          placeholder="Ask anything, or ask for a visual UI…"
          aria-label="Message"
          data-chat-prompt-input
          data-bind={chatForm.refs.prompt}
          data-attr:disabled={chatBusy}
          data-on:keydown="evt.key === 'Enter' && !evt.shiftKey && (evt.preventDefault(), evt.currentTarget.form.requestSubmit())"
        ></textarea>
        <button
          type="submit"
          class="btn-send"
          aria-label="Send message"
          data-attr:disabled={js`${chatBusy} || ${chatForm.refs.prompt}.trim().length === 0`}
        >
          <Icons.send aria-hidden="true" class="h-4 w-4" />
        </button>
      </div>
      <p
        class="mt-2 h-4 px-1 text-[0.8rem] text-danger"
        data-show={chatForm.refs.error}
        data-text={chatForm.refs.error}
      ></p>
    </form>
  </div>
)
