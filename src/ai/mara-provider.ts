import type { Model } from "@earendil-works/pi-ai";

export const maraProviderId = "MARA";
export const maraModelId = "MiniMax-M2.5";

export const maraModel: Model<"openai-completions"> = {
  id: maraModelId,
  name: maraModelId,
  api: "openai-completions",
  provider: maraProviderId,
  baseUrl: "https://api.cloud.mara.com/v1",
  reasoning: true,
  input: ["text"],
  contextWindow: 192000,
  maxTokens: 96000,
  cost: {
    input: 0.3,
    output: 1.2,
    cacheRead: 0,
    cacheWrite: 0,
  },
  compat: {
    supportsDeveloperRole: false,
  },
};

export function getMaraApiKey(): string {
  const apiKey = process.env.MARA_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("MARA_API_KEY is required to use the MARA provider");
  }
  return apiKey;
}
