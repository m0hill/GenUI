import { Type, type Tool } from "@earendil-works/pi-ai"
import { z } from "zod"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"

const ExaResponse = z.object({
  result: z
    .object({
      content: z
        .array(
          z.object({
            type: z.string().optional(),
            text: z.string().optional(),
          }),
        )
        .optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
})

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web for current information.",
  parameters: Type.Object({
    query: Type.String({ minLength: 1, description: "Search query" }),
  }),
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const parseResponse = (body: string): z.infer<typeof ExaResponse> => {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue
    const parsed = ExaResponse.safeParse(parseJson(line.slice(5).trim()))
    if (parsed.success && (parsed.data.result !== undefined || parsed.data.error !== undefined)) {
      return parsed.data
    }
  }

  const parsed = ExaResponse.safeParse(parseJson(body))
  if (parsed.success && (parsed.data.result !== undefined || parsed.data.error !== undefined)) {
    return parsed.data
  }
  throw new Error("Web search returned an unrecognized response")
}

export async function searchWeb(query: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query,
          numResults: 5,
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: 3_000,
        },
      },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  })

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }

  const parsed = parseResponse(await response.text())
  if (parsed.error !== undefined) {
    throw new Error(parsed.error.message ?? "Web search failed")
  }

  const text = parsed.result?.content?.find(
    (item) => item.type === "text" && item.text?.trim().length,
  )?.text
  if (parsed.result?.isError === true || text === undefined) {
    throw new Error(text ?? "Web search returned no results")
  }
  return text
}
