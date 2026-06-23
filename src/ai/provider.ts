import { getModel } from "@earendil-works/pi-ai"
import { basetenModel, getBasetenApiKey } from "./baseten-provider.js"
import { getMaraApiKey, maraModel } from "./mara-provider.js"
import { getCodexApiKey, openAICodexProviderId } from "./pi-auth.js"

const codexModel = getModel(openAICodexProviderId, "gpt-5.5")

const provider = process.env.AI_PROVIDER ?? "mara"

export const aiModel =
  provider === "baseten" ? basetenModel : provider === "codex" ? codexModel : maraModel

export const getAiApiKey =
  provider === "baseten" ? getBasetenApiKey : provider === "codex" ? getCodexApiKey : getMaraApiKey
