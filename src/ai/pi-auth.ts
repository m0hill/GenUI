import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { getOAuthApiKey } from "@earendil-works/pi-ai/oauth"
import { z } from "zod"

export const openAICodexProviderId = "openai-codex"

const authPath = fileURLToPath(new URL("../../auth.json", import.meta.url))

const OAuthCredentials = z
  .object({
    access: z.string(),
    expires: z.number(),
    refresh: z.string(),
  })
  .catchall(z.unknown())

const AuthFile = z
  .object({
    [openAICodexProviderId]: OAuthCredentials,
  })
  .catchall(z.unknown())

export async function getCodexApiKey(): Promise<string> {
  const parsed = AuthFile.safeParse(JSON.parse(await readFile(authPath, "utf8")))
  const missingCredentialsMessage = `No OAuth credentials found for ${openAICodexProviderId} in ${authPath}`
  if (!parsed.success) throw new Error(missingCredentialsMessage)

  const auth = parsed.data
  const result = await getOAuthApiKey(openAICodexProviderId, {
    [openAICodexProviderId]: auth[openAICodexProviderId],
  })
  if (result === null) throw new Error(missingCredentialsMessage)

  auth[openAICodexProviderId] = { ...result.newCredentials, type: "oauth" }
  await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
  return result.apiKey
}
