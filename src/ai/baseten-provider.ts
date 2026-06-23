import type { Model } from "@earendil-works/pi-ai"

export const basetenProviderId = "Baseten"
export const basetenModelId = "zai-org/GLM-5.2"

export const basetenModel: Model<"openai-completions"> = {
  id: basetenModelId,
  name: "GLM 5.2",
  api: "openai-completions",
  provider: basetenProviderId,
  baseUrl: "https://inference.baseten.co/v1",
  reasoning: true,
  input: ["text"],
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  cost: {
    input: 1.5,
    output: 4.5,
    cacheRead: 0.3,
    cacheWrite: 0,
  },
  compat: {
    supportsDeveloperRole: false,
  },
}

export function getBasetenApiKey(): string {
  const apiKey = process.env.BASETEN_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("BASETEN_API_KEY is required to use the Baseten provider")
  }
  return apiKey
}
