import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  ToolCall,
} from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { getCodexApiKey } from "./auth.js"
import { searchWeb, webSearchTool } from "./web-search.js"
import type { ChatMessage } from "../session.js"

export const modelId = "gpt-5.6-terra"

export type ChatStreamEvent =
  | AssistantMessageEvent
  | {
      type: "tool_result"
      toolCallId: string
      query: string
      status: "complete" | "error"
    }

const provider = openaiCodexProvider()
const findModel = () => {
  const found = provider.getModels().find((candidate) => candidate.id === modelId)
  if (found === undefined) {
    throw new Error(`The OpenAI Codex provider does not include ${modelId}`)
  }
  return found
}

const model = findModel()
const maxToolRounds = 5

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

const toProviderMessages = (history: readonly ChatMessage[]): Message[] =>
  history.map((message, index) => {
    const timestamp = Date.now() + index
    if (message.role === "user") {
      return { role: "user", content: message.content, timestamp }
    }

    const content = message.content.filter((block) => block.type !== "tool")
    return {
      role: "assistant",
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage,
      stopReason: "stop",
      timestamp,
    }
  })

export async function streamChat(
  history: readonly ChatMessage[],
  prompt: string,
  signal: AbortSignal,
): Promise<AsyncIterable<ChatStreamEvent>> {
  const apiKey = await getCodexApiKey()
  const context: Context = {
    systemPrompt:
      "You are a concise, helpful assistant. Use web search when current information is needed.",
    messages: [
      ...toProviderMessages(history),
      { role: "user", content: prompt, timestamp: Date.now() },
    ],
    tools: [webSearchTool],
  }

  async function executeTool(
    toolCall: ToolCall,
  ): Promise<{ query: string; status: "complete" | "error" }> {
    const argument = toolCall.arguments.query
    const query = typeof argument === "string" ? argument.trim() : ""
    let text: string
    let isError = false

    try {
      if (toolCall.name !== webSearchTool.name) throw new Error(`Unknown tool: ${toolCall.name}`)
      if (query.length === 0) throw new Error("Web search requires a query")
      text = await searchWeb(query, signal)
    } catch (error) {
      if (signal.aborted) throw new Error("Request aborted")
      text = error instanceof Error ? error.message : "Web search failed"
      isError = true
    }

    context.messages.push({
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text }],
      isError,
      timestamp: Date.now(),
    })
    return { query: query || "Invalid search query", status: isError ? "error" : "complete" }
  }

  async function* run(): AsyncGenerator<ChatStreamEvent> {
    for (let round = 0; ; round += 1) {
      let completed: AssistantMessage | undefined
      const response = provider.stream(model, context, {
        apiKey,
        maxTokens: 2_048,
        reasoningEffort: "low",
        signal,
      })

      for await (const item of response) {
        yield item
        if (item.type === "done") completed = item.message
      }

      if (completed === undefined || completed.stopReason !== "toolUse") return

      const toolCalls = completed.content.filter((block) => block.type === "toolCall")
      if (toolCalls.length === 0) throw new Error("The model requested a tool without a tool call")
      if (round >= maxToolRounds) {
        throw new Error(`The model exceeded the ${maxToolRounds}-round tool limit`)
      }

      context.messages.push(completed)
      for (const toolCall of toolCalls) {
        const result = await executeTool(toolCall)
        yield { type: "tool_result", toolCallId: toolCall.id, ...result }
      }
    }
  }

  return run()
}
