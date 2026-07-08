import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai"
import {
  createUiSurfaceFromToolArguments,
  streamAiTurn,
  type AssistantToolState,
  type CreateUiState,
} from "../ai/index.js"
import {
  appendSessionMessage,
  createSession,
  loadSession,
  messagePreview,
  type PersistedChatSession,
} from "./store.js"
import type { WebSearchState, WebSearchToolDetails } from "../ai/web-search-tool.js"

type AiMessages = Parameters<typeof streamAiTurn>[0]

export type AssistantStatus = "streaming" | "complete" | "error"

export interface UserChatMessage {
  id: string
  role: "user"
  text: string
}

export interface AssistantTurn {
  id: string
  role: "assistant"
  messages: AssistantMessage[]
  tools: Map<string, AssistantToolState>
  status: AssistantStatus
  error?: string
}

export interface ChatSession {
  id: string
  filePath: string
  lastEntryId: string | null
  aiMessages: AiMessages
  messages: Array<UserChatMessage | AssistantTurn>
}

const chats = new Map<string, ChatSession>()

const textFromToolResult = (message: ToolResultMessage | undefined): string => {
  if (message === undefined) return ""
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim()
}

const toolResultsById = (messages: readonly Message[]): Map<string, ToolResultMessage> => {
  const results = new Map<string, ToolResultMessage>()

  for (const message of messages) {
    if (message.role === "toolResult") results.set(message.toolCallId, message)
  }

  return results
}

const webSearchResultsById = (
  messages: readonly Message[],
): Map<string, ToolResultMessage<WebSearchToolDetails>> => {
  const results = new Map<string, ToolResultMessage<WebSearchToolDetails>>()

  for (const message of messages) {
    if (message.role === "toolResult" && message.toolName === "web_search") {
      results.set(message.toolCallId, message)
    }
  }

  return results
}

const createUiStateFromHistory = (
  toolCall: ToolCall,
  result: ToolResultMessage | undefined,
  sessionId: string,
): Promise<CreateUiState> =>
  createUiSurfaceFromToolArguments(toolCall, sessionId).then((surface) => {
    if (result?.isError === true) {
      return {
        status: "error",
        ...(surface === undefined ? {} : { surface }),
        error: textFromToolResult(result) || "The model called create_ui with invalid arguments.",
      }
    }

    return surface === undefined ? { status: "pending" } : { status: "complete", surface }
  })

const webSearchStateFromHistory = (
  toolCall: ToolCall,
  result: ToolResultMessage<WebSearchToolDetails> | undefined,
): WebSearchState => {
  const query = typeof toolCall.arguments.query === "string" ? toolCall.arguments.query.trim() : ""

  if (result === undefined) return { status: "pending", query }

  const details = result.details
  const detailQuery = details?.query ?? query

  if (result.isError) {
    return {
      status: "error",
      query: detailQuery,
      error: details?.error ?? (textFromToolResult(result) || "Web search failed."),
    }
  }

  return {
    status: "complete",
    query: detailQuery,
    summary:
      details?.summary && details.summary.length > 0 ? details.summary : textFromToolResult(result),
  }
}

const chatDisplayMessages = async (
  messages: readonly Message[],
  sessionId: string,
): Promise<Array<UserChatMessage | AssistantTurn>> => {
  const displayMessages: Array<UserChatMessage | AssistantTurn> = []
  const toolResults = toolResultsById(messages)
  const webSearchResults = webSearchResultsById(messages)
  let currentTurn: AssistantTurn | undefined

  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      currentTurn = undefined
      displayMessages.push({
        id: `message-${sessionId}-user-${index}`,
        role: "user",
        text: messagePreview(message),
      })
      continue
    }

    if (message.role !== "assistant") continue

    if (currentTurn === undefined) {
      currentTurn = {
        id: `message-${sessionId}-assistant-${index}`,
        role: "assistant",
        messages: [],
        tools: new Map(),
        status: "complete",
      }
      displayMessages.push(currentTurn)
    }

    currentTurn.messages.push(message)

    for (const content of message.content) {
      if (content.type !== "toolCall") continue
      if (content.name === "create_ui") {
        currentTurn.tools.set(
          content.id,
          await createUiStateFromHistory(content, toolResults.get(content.id), sessionId),
        )
      }
      if (content.name === "web_search") {
        currentTurn.tools.set(
          content.id,
          webSearchStateFromHistory(content, webSearchResults.get(content.id)),
        )
      }
    }
  }

  return displayMessages
}

const toChatSession = async (session: PersistedChatSession): Promise<ChatSession> => ({
  id: session.id,
  filePath: session.filePath,
  lastEntryId: session.lastEntryId,
  aiMessages: [...session.messages],
  messages: await chatDisplayMessages(session.messages, session.id),
})

export const loadChat = async (id: string): Promise<ChatSession | undefined> => {
  const cached = chats.get(id)
  if (cached !== undefined) return cached

  const session = await loadSession(id)
  if (session === undefined) return undefined

  const chat = await toChatSession(session)
  chats.set(chat.id, chat)
  return chat
}

export const createChat = async (): Promise<ChatSession> => {
  const chat = await toChatSession(await createSession())
  chats.set(chat.id, chat)
  return chat
}

export const appendAiMessage = async (chat: ChatSession, message: Message): Promise<void> => {
  await appendSessionMessage(chat, message)
  chat.aiMessages.push(message)
}

export const persistGeneratedMessages = async (
  chat: ChatSession,
  startIndex: number,
): Promise<void> => {
  for (const message of chat.aiMessages.slice(startIndex)) {
    await appendSessionMessage(chat, message)
  }
}
