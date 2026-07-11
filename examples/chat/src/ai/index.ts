import type { AssistantMessageEvent, Context, Message } from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { getCodexApiKey } from "./auth.js"

export const modelId = "gpt-5.6-terra"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
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

    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
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
): Promise<AsyncIterable<AssistantMessageEvent>> {
  const apiKey = await getCodexApiKey()
  const context: Context = {
    systemPrompt: "You are a concise, helpful assistant.",
    messages: [
      ...toProviderMessages(history),
      { role: "user", content: prompt, timestamp: Date.now() },
    ],
  }

  return provider.stream(model, context, {
    apiKey,
    maxTokens: 2_048,
    reasoningEffort: "low",
    signal,
  })
}
