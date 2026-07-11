import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { AssistantMessage as ProviderAssistantMessage } from "@earendil-works/pi-ai"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { event, local, mod, post, preserve, read, reply, state, unsafeHtml } from "datastar-kit"
import { Hono } from "hono"
import { z } from "zod"
import { modelId, streamChat } from "./ai/index.js"
import { renderMarkdown } from "./markdown.js"
import { type AssistantContentBlock, JsonlChatSession } from "./session.js"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const ChatSignals = z.object({
  prompt: z.string().trim().min(1).max(8_000),
})

const chatState = state({
  prompt: "",
})

const sending = local<boolean>("sending")
const session = await JsonlChatSession.open(
  fileURLToPath(new URL("../data/chat.jsonl", import.meta.url)),
)

interface ActiveWebSearch {
  readonly id: string
  readonly query: string
}

const WebSearchActivity = (props: { query: string; status: "running" | "complete" | "error" }) => (
  <div class={`tool-activity ${props.status}`} role="status">
    <span class="tool-status">
      {props.status === "running"
        ? "Searching the web"
        : props.status === "complete"
          ? "Searched the web"
          : "Web search failed"}
    </span>
    <span class="tool-query">{props.query}</span>
  </div>
)

const GeneratedSurface = (props: {
  surface: Extract<AssistantContentBlock, { type: "surface" }>["surface"]
}) => (
  <div
    id={`surface-${props.surface.id}`}
    class="genui-surface"
    data-genui-surface={JSON.stringify(props.surface)}
    data-ignore-morph
  >
    Loading generated interface…
  </div>
)

const AssistantMessage = (props: {
  id: string
  content: readonly AssistantContentBlock[]
  activeSearches?: readonly ActiveWebSearch[]
  pending?: boolean
  error?: string
}) => (
  <article id={props.id} class={`message assistant${props.error ? " error" : ""}`}>
    <span class="message-label">GPT-5.6</span>
    {props.content.map((block) =>
      block.type === "thinking" ? (
        block.thinking.trim().length > 0 ? (
          <details class="thinking" open data-preserve-attr={preserve("open")}>
            <summary>Reasoning</summary>
            <div class="thinking-body markdown">{unsafeHtml(renderMarkdown(block.thinking))}</div>
          </details>
        ) : null
      ) : block.type === "tool" ? (
        <WebSearchActivity query={block.query} status={block.status} />
      ) : block.type === "surface" ? (
        <GeneratedSurface surface={block.surface} />
      ) : block.text.trim().length > 0 ? (
        <div class="message-body markdown">{unsafeHtml(renderMarkdown(block.text))}</div>
      ) : null,
    )}
    {props.activeSearches?.map((search) => (
      <WebSearchActivity query={search.query} status="running" />
    ))}
    {props.pending === true ? <span class="cursor" aria-label="Generating" /> : null}
    {props.error ? <p class="message-body error-detail">{props.error}</p> : null}
  </article>
)

const Turn = (props: {
  id: string
  prompt: string
  assistantId: string
  assistantContent?: readonly AssistantContentBlock[]
}) => (
  <section id={props.id} class="turn">
    <article class="message user">
      <span class="message-label">You</span>
      <p class="message-body">{props.prompt}</p>
    </article>
    <AssistantMessage
      id={props.assistantId}
      content={props.assistantContent ?? []}
      pending={props.assistantContent === undefined}
    />
  </section>
)

const visibleAssistantContent = (
  content: ProviderAssistantMessage["content"],
): AssistantContentBlock[] =>
  content.filter(
    (block): block is Extract<AssistantContentBlock, { type: "text" | "thinking" }> =>
      block.type === "text" || block.type === "thinking",
  )

const app = new Hono()

app.use(
  "/assets/*",
  serveStatic({
    root: fileURLToPath(new URL("../public", import.meta.url)),
    rewriteRequestPath: (path) => path.replace(/^\/assets/, ""),
  }),
)

app.get("/", () => {
  const turns = session.getTurns()
  return reply.page(
    <main class="shell" data-signals={chatState.defaults}>
      <header class="masthead">
        <div class="brand">
          <div class="mark" aria-hidden="true">
            AI
          </div>
          <div>
            <h1>Local conversation</h1>
            <p class="subtitle">OpenAI Codex · {modelId} · reasoning low</p>
          </div>
        </div>
        <div class="status">Saved locally</div>
      </header>

      <section id="messages" aria-live="polite" aria-label="Conversation">
        {turns.length === 0 ? (
          <div id="empty-state" class="empty">
            <p class="empty-kicker">Persistent JSONL · local session</p>
            <h2>A quiet place to think out loud.</h2>
            <p>Ask a question. The answer arrives as server-rendered HTML patches.</p>
          </div>
        ) : (
          turns.map((turn) => (
            <Turn
              id={`turn-${turn.userId}`}
              prompt={turn.prompt}
              assistantId={`assistant-${turn.assistantId}`}
              assistantContent={turn.assistantContent}
            />
          ))
        )}
      </section>

      <form
        class="composer"
        data-indicator={sending}
        data-on:submit={mod(post("/chat"), { prevent: true })}
      >
        <div class="composer-inner">
          <textarea
            aria-label="Message"
            data-bind={chatState.refs.prompt}
            data-attr:disabled={sending}
            maxlength="8000"
            placeholder="Write a message…"
            required
            rows="2"
          />
          <button class="send" type="submit" data-attr:disabled={sending}>
            Send
          </button>
        </div>
        <p id="composer-error" role="alert" />
      </form>
    </main>,
    {
      title: "Local conversation",
      head: [
        <meta name="viewport" content="width=device-width, initial-scale=1" />,
        <link rel="stylesheet" href="/assets/styles.css" />,
        <script type="module" src={DATASTAR_RUNTIME} />,
        <script type="module" src="/client.js" />,
      ],
    },
  )
})

app.get("/client.js", async (c) =>
  c.body(await readFile(new URL("../dist/client.js", import.meta.url), "utf8"), 200, {
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
  }),
)

app.post("/chat", async (c) => {
  const signals = await read.signals(c.req.raw).catch(() => null)
  const parsed = ChatSignals.safeParse(signals)
  if (!parsed.success) {
    return reply.patch(
      <p id="composer-error" role="alert">
        Enter a message between 1 and 8,000 characters.
      </p>,
    )
  }

  const history = session.getHistory().slice(-40)
  const { prompt } = parsed.data
  const userEntryId = randomUUID()
  const assistantEntryId = randomUUID()
  const turnId = `turn-${userEntryId}`
  const assistantId = `assistant-${assistantEntryId}`

  async function* streamHtml() {
    if (history.length === 0) {
      yield event.patch("", { selector: "#empty-state", mode: "remove" })
    }
    yield event.patch(<Turn id={turnId} prompt={prompt} assistantId={assistantId} />, {
      selector: "#messages",
      mode: "append",
    })
    yield event.signals(chatState.patch({ prompt: "" }))
    yield event.patch(<p id="composer-error" role="alert" />)

    let finalContent: AssistantContentBlock[] | undefined
    const completedToolContent: AssistantContentBlock[] = []
    const activeSearches: ActiveWebSearch[] = []
    try {
      const response = await streamChat(history, prompt, c.req.raw.signal)
      for await (const item of response) {
        if (item.type === "text_delta" || item.type === "thinking_delta") {
          yield event.patch(
            <AssistantMessage
              id={assistantId}
              content={[...completedToolContent, ...visibleAssistantContent(item.partial.content)]}
              activeSearches={activeSearches}
              pending
            />,
          )
        }

        if (item.type === "done") {
          const content = visibleAssistantContent(item.message.content)
          if (item.reason === "toolUse") {
            completedToolContent.push(...content)
          } else {
            finalContent = [...completedToolContent, ...content]
          }
        }

        if (item.type === "toolcall_end") {
          const query = item.toolCall.arguments.query
          if (typeof query === "string" && query.trim().length > 0) {
            activeSearches.push({ id: item.toolCall.id, query: query.trim() })
            yield event.patch(
              <AssistantMessage
                id={assistantId}
                content={[
                  ...completedToolContent,
                  ...visibleAssistantContent(item.partial.content),
                ]}
                activeSearches={activeSearches}
                pending
              />,
            )
          }
        }

        if (item.type === "tool_result") {
          const index = activeSearches.findIndex((search) => search.id === item.toolCallId)
          if (index !== -1) activeSearches.splice(index, 1)
          completedToolContent.push({
            type: "tool",
            tool: "web_search",
            query: item.query,
            status: item.status,
          })
          yield event.patch(
            <AssistantMessage
              id={assistantId}
              content={completedToolContent}
              activeSearches={activeSearches}
              pending
            />,
          )
        }

        if (item.type === "surface_result") {
          completedToolContent.push({ type: "surface", surface: item.surface })
          yield event.patch(
            <AssistantMessage
              id={assistantId}
              content={completedToolContent}
              activeSearches={activeSearches}
              pending
            />,
          )
        }

        if (item.type === "error") {
          throw new Error(item.error.errorMessage ?? "The model could not finish this response")
        }
      }

      if (finalContent === undefined || finalContent.length === 0) {
        yield event.patch(
          <AssistantMessage
            id={assistantId}
            content={[]}
            error="The model returned no response."
          />,
        )
        return
      }

      try {
        await session.appendTurn({
          userId: userEntryId,
          assistantId: assistantEntryId,
          prompt,
          assistantContent: finalContent,
        })
      } catch {
        yield event.patch(
          <AssistantMessage
            id={assistantId}
            content={finalContent}
            error="This response could not be saved."
          />,
        )
        return
      }

      yield event.patch(<AssistantMessage id={assistantId} content={finalContent} />)
    } catch (error) {
      const message = error instanceof Error ? error.message : "The model request failed"
      yield event.patch(
        <AssistantMessage
          id={assistantId}
          content={completedToolContent}
          activeSearches={activeSearches}
          error={message}
        />,
      )
    }
  }

  return reply.stream(streamHtml())
})

app.notFound((c) => c.text("Not Found", 404))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log("Chat listening on http://localhost:3000")
})
