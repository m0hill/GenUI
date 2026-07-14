import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { AssistantMessage as ProviderAssistantMessage } from "@earendil-works/pi-ai"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { event, local, mod, post, preserve, read, reply, state, unsafeHtml } from "datastar-kit"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { actionError, parseSubscriptionRequest, subscriptionOpenError } from "genui/protocol"
import { z } from "zod"
import { executeGeneratedUiAction, openGeneratedUiSubscription } from "./ai/genui.js"
import {
  generatedInterfaceOutcomeMessage,
  type GeneratedInterfaceRepairOutcome,
} from "./ai/generated-interface-repair.js"
import { type GeneratedUiModelContext, modelId, streamChat } from "./ai/index.js"
import { parseExecuteRequest, pendingApprovals, type ExecuteEnvelope } from "./approval.js"
import { renderMarkdown } from "./markdown.js"
import { JsonPreferenceStore } from "./preferences.js"
import {
  type AssistantContentBlock,
  JsonlChatSession,
  type PersistedTurn,
  SurfaceSnapshot,
} from "./session.js"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const ChatSignals = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  modelContext: z.string().max(20_000).default(""),
})

const GeneratedUiModelContext = z
  .object({
    surfaceId: z.string().min(1).max(256),
    content: z.string().max(16_384).optional(),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const SurfaceSnapshots = z
  .array(
    z
      .object({
        surfaceId: z.string().min(1).max(256),
        snapshot: SurfaceSnapshot,
      })
      .strict(),
  )
  .max(64)

const chatState = state({
  prompt: "",
  modelContext: "",
})

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const requestJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const ChevronIcon = () => (
  <svg
    class="chevron"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
)

const SendIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

const PlusIcon = () => (
  <svg
    class="pill-icon"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const sending = local<boolean>("sending")
const resetting = local<boolean>("resetting")
const session = await JsonlChatSession.open(
  fileURLToPath(new URL("../data/chat.jsonl", import.meta.url)),
)
const preferences = new JsonPreferenceStore(
  fileURLToPath(new URL("../data/preferences.json", import.meta.url)),
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

const PreferenceActivity = (props: { status: "complete" | "error" }) => (
  <div class={`tool-activity ${props.status}`} role="status">
    <span class="tool-status">
      {props.status === "complete" ? "Read saved preference" : "Could not read saved preference"}
    </span>
  </div>
)

const GeneratedSurface = (props: {
  surface: Extract<AssistantContentBlock, { type: "surface" }>["surface"]
  snapshot?: SurfaceSnapshot
}) => (
  <div
    id={`surface-${props.surface.id}`}
    class="genui-surface"
    data-genui-surface={JSON.stringify(props.surface)}
    data-genui-snapshot={props.snapshot === undefined ? undefined : JSON.stringify(props.snapshot)}
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
            <summary>
              <ChevronIcon />
              Reasoning
            </summary>
            <div class="thinking-body markdown">{unsafeHtml(renderMarkdown(block.thinking))}</div>
          </details>
        ) : null
      ) : block.type === "tool" ? (
        block.tool === "web_search" ? (
          <WebSearchActivity query={block.query} status={block.status} />
        ) : (
          <PreferenceActivity status={block.status} />
        )
      ) : block.type === "surface" ? (
        <GeneratedSurface
          surface={block.surface}
          snapshot={session.getSurfaceSnapshot(block.surface.id)}
        />
      ) : block.text.trim().length > 0 ? (
        <div class="markdown">{unsafeHtml(renderMarkdown(block.text))}</div>
      ) : null,
    )}
    {props.activeSearches?.map((search) => (
      <WebSearchActivity query={search.query} status="running" />
    ))}
    {props.pending === true ? (
      <small class="message-status" role="status">
        Writing
      </small>
    ) : null}
    {props.error ? <p class="error-detail">{props.error}</p> : null}
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
      <p class="user-bubble">{props.prompt}</p>
    </article>
    <AssistantMessage
      id={props.assistantId}
      content={props.assistantContent ?? []}
      pending={props.assistantContent === undefined}
    />
  </section>
)

const Conversation = (props: { turns: readonly PersistedTurn[] }) => (
  <section id="messages" aria-live="polite" aria-label="Conversation">
    {props.turns.length === 0 ? (
      <div id="empty-state" class="empty">
        <p>
          Ask a normal question, or ask for a tiny interface like “make a minimalist weather card
          for San Francisco”.
        </p>
      </div>
    ) : (
      props.turns.map((turn) => (
        <Turn
          id={`turn-${turn.userId}`}
          prompt={turn.prompt}
          assistantId={`assistant-${turn.assistantId}`}
          assistantContent={turn.assistantContent}
        />
      ))
    )}
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
        <p class="manual-kicker">GenUI · {modelId} · saved locally</p>
        <div class="masthead-row">
          <h1>Local conversation</h1>
          <div class="masthead-actions">
            <button
              class="nav-pill nav-pill-accent"
              type="button"
              data-indicator={resetting}
              data-attr:disabled={resetting}
              data-on:click={post("/chat/new")}
            >
              <PlusIcon />
              New chat
            </button>
          </div>
        </div>
      </header>

      <Conversation turns={turns} />

      <form
        class="composer"
        data-indicator={sending}
        data-on:submit={mod(post("/chat"), { prevent: true })}
      >
        <input type="hidden" data-bind={chatState.refs.modelContext} />
        <div class="composer-pill">
          <textarea
            aria-label="Message"
            data-bind={chatState.refs.prompt}
            data-attr:disabled={sending}
            data-on:keydown="evt.key === 'Enter' && !evt.shiftKey && (evt.preventDefault(), evt.currentTarget.form.requestSubmit())"
            maxlength="8000"
            placeholder="Ask anything, or ask for a visual UI…"
            required
            rows="1"
          />
          <button
            class="btn-send"
            type="submit"
            aria-label="Send message"
            data-attr:disabled={sending}
          >
            <SendIcon />
          </button>
        </div>
        <p id="composer-error" role="alert" />
      </form>
    </main>,
    {
      title: "Local conversation",
      head: [
        <meta name="viewport" content="width=device-width, initial-scale=1" />,
        <meta name="color-scheme" content="light" />,
        <link
          rel="preload"
          href="/assets/fonts/geist-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />,
        <link
          rel="preload"
          href="/assets/fonts/geist-mono-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />,
        <link rel="stylesheet" href="/assets/styles.css" />,
        <script type="module" src={DATASTAR_RUNTIME} />,
        <script type="module" src="/assets/client.js" />,
      ],
    },
  )
})

app.post("/genui/execute", async (c) => {
  const request = parseExecuteRequest(await requestJson(c.req.raw))
  if (request === undefined) {
    return c.json(
      {
        result: actionError("invalid_input", "Malformed GenUI action call."),
      } satisfies ExecuteEnvelope,
      400,
    )
  }
  const result = await executeGeneratedUiAction(request.call, preferences, (_action, input) =>
    pendingApprovals.check({
      call: request.call,
      input,
      token: request.approvalToken,
    }),
  )
  const approvalToken =
    !result.ok && result.error.code === "approval_required"
      ? pendingApprovals.token(request.call)
      : undefined
  return c.json({
    result,
    ...(approvalToken === undefined ? {} : { approvalToken }),
  } satisfies ExecuteEnvelope)
})

app.post("/genui/subscribe", async (c) => {
  const request = parseSubscriptionRequest(await requestJson(c.req.raw))
  if (request === undefined) {
    return c.json(subscriptionOpenError("invalid_input", "Malformed subscription request."), 400)
  }

  const requestSignal = c.req.raw.signal
  const sourceController = new AbortController()
  const abortSource = (): void => sourceController.abort()
  if (requestSignal.aborted) abortSource()
  else requestSignal.addEventListener("abort", abortSource, { once: true })
  const detachRequestSignal = (): void => {
    requestSignal.removeEventListener("abort", abortSource)
  }
  const stopSource = (): void => {
    detachRequestSignal()
    sourceController.abort()
  }

  const opened = await openGeneratedUiSubscription(request, preferences, sourceController.signal)
  if (!opened.ok) {
    stopSource()
    return c.json(opened, 400)
  }

  c.header("cache-control", "no-store")
  c.header("content-type", "application/x-ndjson; charset=utf-8")
  c.header("x-content-type-options", "nosniff")
  return stream(c, async (output) => {
    output.onAbort(stopSource)
    try {
      for await (const delivery of opened.events) {
        await output.writeln(JSON.stringify(delivery))
      }
    } finally {
      stopSource()
    }
  })
})

app.post("/genui/snapshots", async (c) => {
  const snapshots = SurfaceSnapshots.safeParse(await requestJson(c.req.raw))
  if (!snapshots.success) return c.json({ error: "Invalid generated UI snapshots." }, 400)
  await session.appendSurfaceSnapshots(snapshots.data)
  return c.body(null, 204)
})

app.post("/chat/new", async () => {
  await session.reset()
  pendingApprovals.clear()
  return reply.stream([
    event.patch(<Conversation turns={[]} />),
    event.signals(chatState.patch({ prompt: "", modelContext: "" })),
    event.patch(<p id="composer-error" role="alert" />),
  ])
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

  const parsedModelContext =
    parsed.data.modelContext.length === 0
      ? undefined
      : GeneratedUiModelContext.safeParse(parseJson(parsed.data.modelContext))
  if (parsedModelContext !== undefined && !parsedModelContext.success) {
    return reply.patch(
      <p id="composer-error" role="alert">
        The generated interface provided invalid model context.
      </p>,
    )
  }
  const modelContext: GeneratedUiModelContext | undefined = parsedModelContext?.data

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
    let repairOutcome: GeneratedInterfaceRepairOutcome | undefined
    const completedToolContent: AssistantContentBlock[] = []
    const activeSearches: ActiveWebSearch[] = []
    try {
      const response = await streamChat({
        history,
        prompt,
        modelContext,
        preferences,
        signal: c.req.raw.signal,
      })
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
          completedToolContent.push(
            item.tool === "web_search"
              ? {
                  type: "tool",
                  tool: "web_search",
                  query: item.query,
                  status: item.status,
                }
              : { type: "tool", tool: "preferences_get", status: item.status },
          )
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

        if (item.type === "generated_interface_attempt") {
          await session.appendGeneratedInterfaceAttempt({
            turnId,
            submission: item.submission,
            evidence: item.evidence,
            diagnostics: item.diagnostics,
          })
        }

        if (item.type === "generated_interface_repair_outcome") {
          repairOutcome = item
          await session.appendGeneratedInterfaceRepairOutcome({
            turnId,
            submissionCount: item.submissionCount,
            reason: item.reason,
            diagnosticCodes: item.diagnosticCodes,
          })
          yield event.patch(
            <AssistantMessage
              id={assistantId}
              content={completedToolContent}
              activeSearches={activeSearches}
              error={generatedInterfaceOutcomeMessage(item.reason)}
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
            content={completedToolContent}
            error={
              repairOutcome === undefined
                ? "The model returned no response."
                : generatedInterfaceOutcomeMessage(repairOutcome.reason)
            }
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

      yield event.patch(
        <AssistantMessage
          id={assistantId}
          content={finalContent}
          error={
            repairOutcome === undefined
              ? undefined
              : generatedInterfaceOutcomeMessage(repairOutcome.reason)
          }
        />,
      )
    } catch (error) {
      console.error("Chat response could not be completed.", error)
      yield event.patch(
        <AssistantMessage
          id={assistantId}
          content={completedToolContent}
          activeSearches={activeSearches}
          error="The response could not be completed."
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
