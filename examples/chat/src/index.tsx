import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { event, local, mod, post, read, reply, state } from "datastar-kit"
import { Hono } from "hono"
import { z } from "zod"
import { modelId, streamChat } from "./ai/index.js"
import { JsonlChatSession } from "./session.js"

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

const AssistantMessage = (props: {
  id: string
  content: string
  pending?: boolean
  error?: boolean
}) => (
  <article id={props.id} class={`message assistant${props.error === true ? " error" : ""}`}>
    <span class="message-label">GPT-5.6</span>
    <p class="message-body">
      {props.content}
      {props.pending === true ? <span class="cursor" aria-label="Generating" /> : null}
    </p>
  </article>
)

const Turn = (props: {
  id: string
  prompt: string
  assistantId: string
  assistantContent?: string
}) => (
  <section id={props.id} class="turn">
    <article class="message user">
      <span class="message-label">You</span>
      <p class="message-body">{props.prompt}</p>
    </article>
    <AssistantMessage
      id={props.assistantId}
      content={props.assistantContent ?? ""}
      pending={props.assistantContent === undefined}
    />
  </section>
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
              assistantContent={turn.response}
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
      ],
    },
  )
})

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

    let content = ""
    try {
      const response = await streamChat(history, prompt, c.req.raw.signal)
      for await (const item of response) {
        if (item.type === "text_delta") {
          content += item.delta
          yield event.patch(<AssistantMessage id={assistantId} content={content} pending />)
        }

        if (item.type === "error") {
          throw new Error(item.error.errorMessage ?? "The model could not finish this response")
        }
      }

      if (content.length === 0) {
        yield event.patch(<AssistantMessage id={assistantId} content="No response." />)
        return
      }

      try {
        await session.appendTurn({
          userId: userEntryId,
          assistantId: assistantEntryId,
          prompt,
          response: content,
        })
      } catch {
        yield event.patch(
          <AssistantMessage
            id={assistantId}
            content={`${content}\n\nThis response could not be saved.`}
            error
          />,
        )
        return
      }

      yield event.patch(<AssistantMessage id={assistantId} content={content} />)
    } catch (error) {
      const message = error instanceof Error ? error.message : "The model request failed"
      yield event.patch(<AssistantMessage id={assistantId} content={message} error />)
    }
  }

  return reply.stream(streamHtml())
})

app.notFound((c) => c.text("Not Found", 404))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log("Chat listening on http://localhost:3000")
})
