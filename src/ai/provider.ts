import { getModel } from "@earendil-works/pi-ai";
import { getMaraApiKey, maraModel } from "./mara-provider.js";
import { getCodexApiKey, openAICodexProviderId } from "./pi-auth.js";

const useMara = (process.env.AI_PROVIDER ?? "mara") === "mara";

export const aiModel = useMara ? maraModel : getModel(openAICodexProviderId, "gpt-5.5");
export const getAiApiKey = useMara ? getMaraApiKey : getCodexApiKey;
