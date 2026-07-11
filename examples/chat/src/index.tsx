import { randomUUID } from "node:crypto"
import { serve } from "@hono/node-server"
import { event, local, mod, post, read, reply, state } from "datastar-kit"
import { Hono } from "hono"
import { z } from "zod"
import { type ChatMessage, modelId, streamChat } from "./ai/index.js"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(16_000),
})

const ChatSignals = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  history: z.string().max(500_000),
})

const History = z.array(ChatMessageSchema).max(40)

const chatState = state({
  prompt: "",
  history: "[]",
})

const sending = local<boolean>("sending")

const styles = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f2f0eb;
    color: #20201e;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background:
      linear-gradient(rgba(32, 32, 30, 0.035) 1px, transparent 1px),
      #f2f0eb;
    background-size: 100% 32px;
  }

  button, textarea { font: inherit; }

  .shell {
    width: min(100%, 900px);
    min-height: 100vh;
    margin: 0 auto;
    padding: 28px 24px 24px;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 24px;
  }

  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 18px;
    border-bottom: 1px solid #cbc7bd;
  }

  .brand { display: flex; align-items: center; gap: 12px; }

  .mark {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid #262624;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-weight: 700;
  }

  h1 { margin: 0; font-size: 15px; letter-spacing: 0.01em; }

  .subtitle {
    margin: 2px 0 0;
    color: #6d6a63;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #5e5b55;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .status::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #3f7652;
    box-shadow: 0 0 0 3px rgba(63, 118, 82, 0.12);
  }

  #messages {
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 28px;
    padding: 20px 0 12px;
  }

  .empty {
    align-self: center;
    max-width: 460px;
    margin: auto;
    padding: 72px 24px;
    text-align: center;
  }

  .empty-kicker {
    margin: 0 0 14px;
    color: #7a766e;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
  }

  .empty h2 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(30px, 5vw, 46px);
    font-weight: 400;
    line-height: 1.08;
    letter-spacing: -0.035em;
  }

  .empty p:last-child { margin: 18px 0 0; color: #6d6a63; line-height: 1.6; }

  .turn { display: grid; gap: 16px; }

  .message {
    max-width: 78%;
    line-height: 1.65;
  }

  .message-label {
    display: block;
    margin-bottom: 7px;
    color: #77736b;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .message-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

  .message.user {
    justify-self: end;
    padding: 12px 15px;
    border: 1px solid #d1cdc3;
    background: rgba(255, 255, 255, 0.58);
  }

  .message.user .message-label { text-align: right; }

  .message.assistant {
    position: relative;
    justify-self: start;
    padding-left: 18px;
  }

  .message.assistant::before {
    content: "";
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    width: 2px;
    background: #b45135;
  }

  .message.error::before { background: #a13232; }
  .message.error .message-body { color: #8a2929; }

  .cursor {
    display: inline-block;
    width: 7px;
    height: 1em;
    margin-left: 3px;
    vertical-align: -0.14em;
    background: #b45135;
    animation: blink 0.9s steps(2, start) infinite;
  }

  @keyframes blink { 50% { opacity: 0; } }

  .composer {
    position: sticky;
    bottom: 0;
    padding-top: 4px;
    background: linear-gradient(transparent, #f2f0eb 18px);
  }

  .composer-inner {
    padding: 12px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 12px;
    border: 1px solid #aaa69c;
    background: rgba(250, 249, 246, 0.96);
    box-shadow: 0 12px 40px rgba(47, 44, 39, 0.08);
  }

  textarea {
    width: 100%;
    min-height: 48px;
    max-height: 180px;
    padding: 12px;
    resize: vertical;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    line-height: 1.5;
  }

  textarea::placeholder { color: #918d84; }

  textarea:focus-visible { box-shadow: inset 0 0 0 1px #7d7970; }

  .send {
    min-width: 94px;
    height: 44px;
    padding: 0 18px;
    border: 1px solid #262624;
    background: #262624;
    color: #f8f6f0;
    cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    transition: background 140ms ease, color 140ms ease;
  }

  .send:hover { background: #b45135; border-color: #b45135; }
  .send:disabled { cursor: wait; opacity: 0.55; }

  #composer-error {
    min-height: 18px;
    margin: 7px 2px 0;
    color: #8a2929;
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .shell { padding: 18px 14px 14px; gap: 14px; }
    .status { display: none; }
    .message { max-width: 92%; }
    .composer-inner { grid-template-columns: 1fr; }
    .send { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .cursor { animation: none; }
  }
`

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

const Turn = (props: { id: string; prompt: string; assistantId: string }) => (
  <section id={props.id} class="turn">
    <article class="message user">
      <span class="message-label">You</span>
      <p class="message-body">{props.prompt}</p>
    </article>
    <AssistantMessage id={props.assistantId} content="" pending />
  </section>
)

const app = new Hono()

app.get("/", () =>
  reply.page(
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
        <div class="status">Ready</div>
      </header>

      <section id="messages" aria-live="polite" aria-label="Conversation">
        <div id="empty-state" class="empty">
          <p class="empty-kicker">No persistence · browser session only</p>
          <h2>A quiet place to think out loud.</h2>
          <p>Ask a question. The answer arrives as server-rendered HTML patches.</p>
        </div>
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
        <style>{styles}</style>,
        <script type="module" src={DATASTAR_RUNTIME} />,
      ],
    },
  ),
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

  let historyValue: unknown
  try {
    historyValue = JSON.parse(parsed.data.history)
  } catch {
    historyValue = null
  }

  const parsedHistory = History.safeParse(historyValue)
  if (!parsedHistory.success) {
    return reply.patch(
      <p id="composer-error" role="alert">
        The browser conversation state is invalid. Reload the page to start over.
      </p>,
    )
  }

  const history: ChatMessage[] = parsedHistory.data
  const { prompt } = parsed.data
  const turnId = `turn-${randomUUID()}`
  const assistantId = `assistant-${randomUUID()}`

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

      const completedHistory = [...history, { role: "user", content: prompt } as const]
      if (content.length > 0) {
        completedHistory.push({ role: "assistant", content })
      }

      yield event.patch(<AssistantMessage id={assistantId} content={content || "No response."} />)
      yield event.signals(chatState.patch({ history: JSON.stringify(completedHistory) }))
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
