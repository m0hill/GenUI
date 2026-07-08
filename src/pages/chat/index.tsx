import { randomUUID } from "node:crypto"
import type { Message } from "@earendil-works/pi-ai"
import { Hono } from "hono"
import { z } from "zod"
import { event, get, mod, read, reply, unsafeHtml } from "datastar-kit"
import { streamAiTurn } from "../../ai/index.js"
import { genuiCapabilities } from "../../genui/default-primitives.js"
import {
  appendAiMessage,
  createChat,
  loadChat,
  persistGeneratedMessages,
  type AssistantTurn,
  type ChatSession,
  type UserChatMessage,
} from "../../session/chat-session.js"
import { chatInvalidations } from "../../session/invalidation-bus.js"
import { pageHead } from "../../ui/head.js"
import { NewChatButton, PageHeader, SessionsLink } from "../../ui/layout.js"
import { generatedUiHostScript } from "./generated-ui-host.js"
import { AssistantTurnItem, ComposerBar, MessagesList, UserMessageItem, chatForm } from "./ui.js"

const ChatSignals = z.object({
  chatId: z.string(),
  prompt: z.string().trim().min(1, "Type a message before sending."),
})

const GenuiCapabilityRequest = z.object({
  capability: z.string(),
  input: z.unknown().optional(),
  chatId: z.string().optional(),
  approved: z.boolean().default(false),
})

const sessionUrl = (chatId: string): string => `/?chatId=${encodeURIComponent(chatId)}`
const liveUrl = (chatId: string): string => `/live?chatId=${encodeURIComponent(chatId)}`

const isGenerating = (chat: ChatSession): boolean =>
  chat.messages.some((message) => message.role === "assistant" && message.status === "streaming")

const ChatApp = (props: { chat: ChatSession | undefined }) => (
  <div
    class="min-h-dvh"
    data-chat-session-id={props.chat?.id ?? ""}
    data-init={props.chat === undefined ? undefined : get(liveUrl(props.chat.id))}
    data-signals={mod(
      chatForm.reset({
        chatId: props.chat?.id ?? "",
        _generating: props.chat !== undefined && isGenerating(props.chat),
      }),
      { ifMissing: true },
    )}
  >
    <main class="shell pt-10 pb-44 lg:pt-16">
      <PageHeader
        title="Hono AI chat"
        actions={
          <>
            <SessionsLink />
            <NewChatButton />
          </>
        }
      />

      <MessagesList messages={props.chat?.messages ?? []} />
    </main>

    <ComposerBar />
  </div>
)

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : "Something went wrong."

const chatSyncEvents = (chat: ChatSession): string[] => [
  event.patch(<MessagesList messages={chat.messages} />),
  event.signals(chatForm.patch({ _generating: isGenerating(chat) })),
]

async function* liveChatEvents(chat: ChatSession, signal: AbortSignal): AsyncIterable<string> {
  yield* chatSyncEvents(chat)

  for await (const _ of chatInvalidations(chat.id).subscribe(signal)) {
    yield* chatSyncEvents(chat)
  }
}

async function* chatEvents(
  chat: ChatSession,
  prompt: string,
  signal: AbortSignal,
  isNew: boolean,
): AsyncIterable<string> {
  const userAiMessage: Message = { role: "user", content: prompt, timestamp: Date.now() }
  const userMessage: UserChatMessage = {
    id: `message-${randomUUID()}`,
    role: "user",
    text: prompt,
  }
  const turn: AssistantTurn = {
    id: `message-${randomUUID()}`,
    role: "assistant",
    messages: [],
    tools: new Map(),
    status: "streaming",
  }
  const wasEmpty = chat.messages.length === 0

  yield event.signals(chatForm.patch({ _generating: true, error: "" }))

  try {
    await appendAiMessage(chat, userAiMessage)
  } catch (error) {
    yield event.signals(chatForm.patch({ error: errorMessage(error), _generating: false }))
    return
  }

  chat.messages.push(userMessage, turn)
  chatInvalidations(chat.id).publish()

  if (isNew) {
    yield event.signals(chatForm.patch({ chatId: chat.id, prompt: "", error: "" }))
    yield event.script(`history.replaceState(null, "", ${JSON.stringify(sessionUrl(chat.id))})`)
  } else {
    yield event.signals(chatForm.patch({ prompt: "", error: "" }))
  }
  if (wasEmpty) {
    yield event.patch("", { selector: "#empty-state", mode: "remove" })
  }
  yield event.patch(
    <>
      <UserMessageItem message={userMessage} />
      <AssistantTurnItem turn={turn} />
    </>,
    { selector: "#messages", mode: "append" },
  )

  let nextUnpersistedMessageIndex = chat.aiMessages.length

  try {
    for await (const update of streamAiTurn(chat.aiMessages, { sessionId: chat.id, signal })) {
      if (chat.aiMessages.length > nextUnpersistedMessageIndex) {
        await persistGeneratedMessages(chat, nextUnpersistedMessageIndex)
        nextUnpersistedMessageIndex = chat.aiMessages.length
      }

      if (update.type === "assistant_update") {
        turn.messages[update.messageIndex] = update.message
      } else {
        turn.tools.set(update.toolCall.id, update.state)
      }

      yield event.patch(<AssistantTurnItem turn={turn} />)
      chatInvalidations(chat.id).publish()
    }

    await persistGeneratedMessages(chat, nextUnpersistedMessageIndex)
    turn.status = "complete"
  } catch (error) {
    turn.status = "error"
    turn.error = errorMessage(error)
  }

  yield event.patch(<AssistantTurnItem turn={turn} />)
  yield event.signals(chatForm.patch({ _generating: false }))
  chatInvalidations(chat.id).publish()
}

const chat = new Hono()

chat.get("/", async (c) => {
  const chatId = c.req.query("chatId")
  const session = chatId === undefined ? undefined : await loadChat(chatId)
  return reply.page(<ChatApp chat={session} />, {
    title: "Hono AI chat",
    head: [...pageHead, <script>{unsafeHtml(generatedUiHostScript)}</script>],
  })
})

chat.get("/live", async (c) => {
  const chatId = c.req.query("chatId")
  if (chatId === undefined) return c.text("Missing chatId", 400)

  const session = await loadChat(chatId)
  if (session === undefined) return c.text("Not Found", 404)

  return reply.stream(liveChatEvents(session, c.req.raw.signal), {
    heartbeat: { intervalMs: 15_000, comment: "chat-live" },
  })
})

chat.post("/chat", async (c) => {
  const result = ChatSignals.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)
    return reply.signals(
      chatForm.patch({
        error: fieldErrors.prompt?.[0] ?? "Invalid chat request.",
        _generating: false,
      }),
    )
  }

  const { chatId, prompt } = result.data

  const isNew = chatId === ""
  const session = isNew ? await createChat() : await loadChat(chatId)
  if (session === undefined) {
    return reply.signals(
      chatForm.patch({
        error: "This chat session expired. Refresh to start over.",
        _generating: false,
      }),
    )
  }

  return reply.stream(chatEvents(session, prompt, c.req.raw.signal, isNew), {
    heartbeat: { intervalMs: 15_000, comment: "ai-chat" },
  })
})

chat.post("/genui/capability", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: "Capability request must be JSON." }, 400)
  }

  const request = GenuiCapabilityRequest.safeParse(body)
  if (!request.success) {
    return c.json({ ok: false, error: "Capability request is invalid." }, 400)
  }

  const result = await genuiCapabilities.execute({
    capability: request.data.capability,
    input: request.data.input ?? {},
    approved: request.data.approved,
    chatId: request.data.chatId,
    signal: c.req.raw.signal,
  })

  return c.json(result, result.ok ? 200 : 400)
})

export default chat
