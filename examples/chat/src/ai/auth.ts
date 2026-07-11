import { chmod, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { getOAuthApiKey } from "@earendil-works/pi-ai/oauth"
import { z } from "zod"

export const openAICodexProviderId = "openai-codex"

const authPath = fileURLToPath(new URL("../../auth.json", import.meta.url))

const OAuthCredentials = z
  .object({
    type: z.literal("oauth"),
    access: z.string().min(1),
    expires: z.number(),
    refresh: z.string().min(1),
    accountId: z.string().min(1),
  })
  .strict()

const AuthFile = z
  .object({
    [openAICodexProviderId]: OAuthCredentials,
  })
  .strict()

type AuthStorage = z.infer<typeof AuthFile>

const loadAuthStorage = async (): Promise<AuthStorage> => {
  const parsed = AuthFile.safeParse(JSON.parse(await readFile(authPath, "utf8")))
  if (!parsed.success) {
    throw new Error(`No OAuth credentials found for ${openAICodexProviderId} in ${authPath}`)
  }
  return parsed.data
}

const saveAuthStorage = async (auth: AuthStorage): Promise<void> => {
  await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8")
  await chmod(authPath, 0o600)
}

/** Returns a current Codex access token, refreshing and persisting it when expired. */
export async function getCodexApiKey(): Promise<string> {
  const auth = await loadAuthStorage()
  const missingCredentialsMessage = `No OAuth credentials found for ${openAICodexProviderId} in ${authPath}`
  const { type: _type, ...credentials } = auth[openAICodexProviderId]
  const result = await getOAuthApiKey(openAICodexProviderId, {
    [openAICodexProviderId]: credentials,
  })
  if (result === null) throw new Error(missingCredentialsMessage)

  auth[openAICodexProviderId] = OAuthCredentials.parse({
    ...result.newCredentials,
    type: "oauth",
  })
  await saveAuthStorage(auth)
  return result.apiKey
}
