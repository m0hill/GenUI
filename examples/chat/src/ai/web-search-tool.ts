import { Type, type Tool, type ToolCall, type ToolResultMessage } from "@earendil-works/pi-ai"
import { z } from "zod"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"
const DEFAULT_WEB_RESULT_COUNT = 5
const MAX_WEB_RESULT_COUNT = 20
const MAX_WEB_CONTENT_CHARS = 50_000
const WEB_SEARCH_BRIEF_CHARS = 3000
const DEFAULT_IMAGE_RESULT_COUNT = 6
const MAX_IMAGE_RESULT_COUNT = 12
const IMAGE_PAGE_FETCH_COUNT = 4
const MAX_IMAGE_PAGE_CHARS = 250_000

const recencyFilterSchema = Type.Union([
  Type.Literal("day"),
  Type.Literal("week"),
  Type.Literal("month"),
  Type.Literal("year"),
])

const webSearchParameters = Type.Object({
  query: Type.String({ minLength: 1, pattern: "\\S", description: "Search query" }),
  numResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_WEB_RESULT_COUNT,
      description: "Number of results, default 5, max 20",
    }),
  ),
  domainFilter: Type.Optional(
    Type.Array(Type.String(), { description: "Domains to include; prefix with - to exclude" }),
  ),
  recencyFilter: Type.Optional(recencyFilterSchema),
  includeContent: Type.Optional(Type.Boolean({ description: "Ask Exa to include more page text" })),
  includeImages: Type.Optional(
    Type.Boolean({
      description:
        "Find embeddable image candidates from the returned pages. Use when a generated UI should include real images.",
    }),
  ),
  imageResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_IMAGE_RESULT_COUNT,
      description: "Number of image candidates to return when includeImages is true, default 6",
    }),
  ),
})

const webSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  numResults: z.number().int().min(1).max(MAX_WEB_RESULT_COUNT).default(DEFAULT_WEB_RESULT_COUNT),
  domainFilter: z.array(z.string().trim().min(1)).default([]),
  recencyFilter: z.enum(["day", "week", "month", "year"]).optional(),
  includeContent: z.boolean().default(false),
  includeImages: z.boolean().default(false),
  imageResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_IMAGE_RESULT_COUNT)
    .default(DEFAULT_IMAGE_RESULT_COUNT),
})

type WebSearchInput = z.infer<typeof webSearchInputSchema>

export interface WebImageCandidate {
  imageUrl: string
  sourceUrl: string
  sourceTitle?: string
  alt?: string
}

export type WebSearchState =
  | { status: "pending"; query: string }
  | { status: "searching"; query: string }
  | { status: "complete"; query: string; summary: string }
  | { status: "error"; query: string; error: string }

export interface WebSearchToolDetails {
  query: string
  searchQuery?: string
  includeContent?: boolean
  includeImages?: boolean
  images?: WebImageCandidate[]
  summary?: string
  error?: string
}

export const webSearchTool = {
  name: "web_search",
  description:
    "Search the web through Exa MCP for current information. Can optionally return embeddable image candidates from result pages.",
  parameters: webSearchParameters,
} satisfies Tool<typeof webSearchParameters>

const exaMcpContentSchema = z.object({ type: z.string().optional(), text: z.string().optional() })
const exaMcpResultSchema = z.object({
  content: z.array(exaMcpContentSchema).optional(),
  isError: z.boolean().optional(),
})
const exaMcpErrorSchema = z.object({ code: z.number().optional(), message: z.string().optional() })
const exaMcpRpcResponseSchema = z.union([
  z.object({ result: exaMcpResultSchema, error: z.undefined().optional() }),
  z.object({ result: z.undefined().optional(), error: exaMcpErrorSchema }),
])

type ExaMcpRpcResponse = z.infer<typeof exaMcpRpcResponseSchema>

type ParsedAttribute = { name: string; value: string | undefined }

type ImageCandidateWithScore = WebImageCandidate & { score: number }

async function callExaMcp(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(60_000)
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
      params: { name: toolName, arguments: args },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Exa MCP error ${response.status}: ${text.slice(0, 500)}`)
  }

  const body = await response.text()
  const parsed = parseMcpResponse(body)

  if (parsed.error) {
    const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : ""
    throw new Error(`Exa MCP error${code}: ${parsed.error.message || "Unknown error"}`)
  }

  if (parsed.result?.isError) {
    const message = parsed.result.content?.find((item) => item.type === "text")?.text?.trim()
    throw new Error(message || "Exa MCP returned an error")
  }

  const text = parsed.result?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0,
  )?.text

  if (!text) throw new Error("Exa MCP returned empty content")
  return text
}

function parseMcpResponse(body: string): ExaMcpRpcResponse {
  const ssePayloads = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  for (const payload of [...ssePayloads, body]) {
    if (!payload) continue
    try {
      const value: unknown = JSON.parse(payload)
      const result = exaMcpRpcResponseSchema.safeParse(value)
      if (result.success) return result.data
    } catch {}
  }

  throw new Error("Exa MCP returned an unrecognized response")
}

function buildSearchQuery({
  query,
  domainFilter,
  recencyFilter,
}: Pick<WebSearchInput, "query" | "domainFilter" | "recencyFilter">): string {
  const parts = [query]
  for (const domain of domainFilter) {
    parts.push(domain.startsWith("-") ? `-site:${domain.slice(1)}` : `site:${domain}`)
  }

  if (recencyFilter) {
    const now = new Date()
    if (recencyFilter === "day") parts.push("past 24 hours")
    if (recencyFilter === "week") parts.push("past week")
    if (recencyFilter === "month") {
      parts.push(`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`)
    }
    if (recencyFilter === "year") parts.push(String(now.getFullYear()))
  }

  return parts.join(" ")
}

function trimChars(text: string, maxChars = MAX_WEB_CONTENT_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}\n\n[Truncated to ${maxChars} characters.]`
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_match, digits: string) => characterReference(Number(digits)))
    .replace(/&#x([\da-f]+);?/gi, (_match, digits: string) =>
      characterReference(Number.parseInt(digits, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
}

function characterReference(codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : ""
}

function parseAttributes(source: string): ParsedAttribute[] {
  const attributes: ParsedAttribute[] = []
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (name === undefined || name === "/") continue
    attributes.push({ name, value: match[2] ?? match[3] ?? match[4] })
  }

  return attributes
}

function attributeValue(attributes: readonly ParsedAttribute[], name: string): string | undefined {
  const found = attributes.find((attribute) => attribute.name.toLowerCase() === name)
  return found?.value
}

function pageTitle(html: string): string | undefined {
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title = raw === undefined ? "" : decodeHtmlEntities(raw.replace(/<[^>]*>/g, "").trim())
  return title.length === 0 ? undefined : title
}

function normalizeHttpUrl(value: string, baseUrl?: string): string | undefined {
  const cleaned = decodeHtmlEntities(value).trim()
  if (cleaned.length === 0) return undefined

  try {
    const parsed = baseUrl === undefined ? new URL(cleaned) : new URL(cleaned, baseUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    parsed.hash = ""
    return parsed.href
  } catch {
    return undefined
  }
}

function isBlockedLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === "localhost" || lower.endsWith(".localhost")) return true
  if (lower === "0.0.0.0" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]") {
    return true
  }

  const parts = lower.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false

  const [a, b] = parts
  if (a === undefined || b === undefined) return false
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function isFetchablePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !isBlockedLocalHostname(parsed.hostname)
    )
  } catch {
    return false
  }
}

function isLikelyUsefulImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false

    const source = `${parsed.pathname}${parsed.search}`.toLowerCase()
    if (/\b(?:favicon|sprite|spacer|blank|pixel|tracking|analytics)\b/.test(source)) return false
    if (/\.(?:ico|svg)(?:[?#]|$)/i.test(source)) return false
    return true
  } catch {
    return false
  }
}

function imageScore(url: string, source: "meta" | "img" | "text"): number {
  let score = source === "meta" ? 100 : source === "img" ? 50 : 25
  if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)) score += 20
  if (/\b(?:hero|photo|image|cover|large|original|media)\b/i.test(url)) score += 8
  if (/\b(?:thumb|thumbnail|small|icon|logo)\b/i.test(url)) score -= 12
  return score
}

function firstSrcsetUrl(srcset: string): string | undefined {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .find((candidate): candidate is string => candidate !== undefined && candidate.length > 0)
}

function searchResultUrls(text: string): string[] {
  const urls = new Set<string>()

  for (const match of text.matchAll(/^URL:\s*(https?:\/\/\S+)\s*$/gim)) {
    const url = normalizeHttpUrl(match[1] ?? "")
    if (url !== undefined && isFetchablePageUrl(url)) urls.add(url)
  }

  return [...urls]
}

function imagesFromText(text: string): ImageCandidateWithScore[] {
  const candidates: ImageCandidateWithScore[] = []

  for (const match of text.matchAll(
    /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi,
  )) {
    const imageUrl = normalizeHttpUrl(match[0])
    if (imageUrl === undefined || !isLikelyUsefulImageUrl(imageUrl)) continue
    candidates.push({ imageUrl, sourceUrl: imageUrl, score: imageScore(imageUrl, "text") })
  }

  return candidates
}

function imagesFromHtml(html: string, sourceUrl: string): ImageCandidateWithScore[] {
  const candidates: ImageCandidateWithScore[] = []
  const sourceTitle = pageTitle(html)

  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "")
    const key = (attributeValue(attributes, "property") ?? attributeValue(attributes, "name") ?? "")
      .trim()
      .toLowerCase()
    if (key !== "og:image" && key !== "og:image:url" && key !== "twitter:image") continue

    const imageUrl = normalizeHttpUrl(attributeValue(attributes, "content") ?? "", sourceUrl)
    if (imageUrl === undefined || !isLikelyUsefulImageUrl(imageUrl)) continue
    candidates.push({
      imageUrl,
      sourceUrl,
      ...(sourceTitle === undefined ? {} : { sourceTitle }),
      score: imageScore(imageUrl, "meta"),
    })
  }

  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "")
    const rel = (attributeValue(attributes, "rel") ?? "").toLowerCase()
    if (!rel.split(/\s+/).includes("image_src")) continue

    const imageUrl = normalizeHttpUrl(attributeValue(attributes, "href") ?? "", sourceUrl)
    if (imageUrl === undefined || !isLikelyUsefulImageUrl(imageUrl)) continue
    candidates.push({
      imageUrl,
      sourceUrl,
      ...(sourceTitle === undefined ? {} : { sourceTitle }),
      score: imageScore(imageUrl, "meta"),
    })
  }

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "")
    const src =
      attributeValue(attributes, "src") ??
      attributeValue(attributes, "data-src") ??
      attributeValue(attributes, "data-original") ??
      attributeValue(attributes, "data-lazy-src") ??
      firstSrcsetUrl(attributeValue(attributes, "srcset") ?? "")
    const imageUrl = normalizeHttpUrl(src ?? "", sourceUrl)
    if (imageUrl === undefined || !isLikelyUsefulImageUrl(imageUrl)) continue

    const alt = decodeHtmlEntities(attributeValue(attributes, "alt") ?? "").trim()
    candidates.push({
      imageUrl,
      sourceUrl,
      ...(sourceTitle === undefined ? {} : { sourceTitle }),
      ...(alt.length > 0 ? { alt } : {}),
      score: imageScore(imageUrl, "img"),
    })
  }

  return candidates
}

function dedupeImages(
  candidates: readonly ImageCandidateWithScore[],
  count: number,
): WebImageCandidate[] {
  const byUrl = new Map<string, ImageCandidateWithScore>()

  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.imageUrl)
    if (existing === undefined || candidate.score > existing.score) {
      byUrl.set(candidate.imageUrl, candidate)
    }
  }

  return [...byUrl.values()]
    .toSorted((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ score: _score, ...candidate }) => candidate)
}

async function fetchPageHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(10_000)
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "hono-ai-example/1.0" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })

  if (!response.ok) return ""
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.length > 0 && !contentType.includes("html") && !contentType.includes("text")) {
    return ""
  }

  return (await response.text()).slice(0, MAX_IMAGE_PAGE_CHARS)
}

async function findImageCandidates(
  searchText: string,
  imageResults: number,
  signal?: AbortSignal,
): Promise<WebImageCandidate[]> {
  const pageUrls = searchResultUrls(searchText).slice(0, IMAGE_PAGE_FETCH_COUNT)
  const candidates = imagesFromText(searchText)

  const fetched = await Promise.allSettled(
    pageUrls.map(async (url) => imagesFromHtml(await fetchPageHtml(url, signal), url)),
  )

  for (const result of fetched) {
    if (result.status === "fulfilled") candidates.push(...result.value)
  }

  return dedupeImages(candidates, imageResults)
}

function formatImagesForModel(images: readonly WebImageCandidate[]): string {
  if (images.length === 0) return "No embeddable image candidates were found."

  return images
    .map((image, index) => {
      const alt = image.alt ?? image.sourceTitle ?? "image"
      return `${index + 1}. ${alt}\n   imageUrl: ${image.imageUrl}\n   sourceUrl: ${image.sourceUrl}`
    })
    .join("\n")
}

function formatToolText(text: string, images: readonly WebImageCandidate[]): string {
  if (images.length === 0) return trimChars(text)

  return trimChars(
    `${text.trimEnd()}\n\nEmbeddable image candidates for generated UI:\n${formatImagesForModel(images)}\n\nUse imageUrl values exactly in <img src="..."> tags, include alt text, and mention/cite sourceUrl when relevant.`,
  )
}

function formatSummary(text: string, images: readonly WebImageCandidate[]): string {
  const summary = trimChars(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n"),
    images.length > 0 ? 650 : 900,
  )

  if (images.length === 0) return summary

  return `${summary}\n\nImages:\n${formatImagesForModel(images.slice(0, 3))}`
}

export async function executeWebSearchTool(
  toolCall: ToolCall,
  signal?: AbortSignal,
): Promise<ToolResultMessage<WebSearchToolDetails>> {
  let query = ""

  try {
    const input = webSearchInputSchema.parse(toolCall.arguments)
    query = input.query

    const searchQuery = buildSearchQuery(input)
    const text = await callExaMcp(
      "web_search_exa",
      {
        query: searchQuery,
        numResults: input.numResults,
        livecrawl: "fallback",
        type: "auto",
        contextMaxCharacters: input.includeContent ? MAX_WEB_CONTENT_CHARS : WEB_SEARCH_BRIEF_CHARS,
      },
      signal,
    )
    const images = input.includeImages
      ? await findImageCandidates(text, input.imageResults, signal)
      : []
    const summary = formatSummary(text, images)

    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: formatToolText(text, images) }],
      details: {
        query,
        searchQuery,
        includeContent: input.includeContent,
        includeImages: input.includeImages,
        ...(images.length > 0 ? { images } : {}),
        summary,
      },
      isError: false,
      timestamp: Date.now(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: `Error: ${message}` }],
      details: { query, error: message },
      isError: true,
      timestamp: Date.now(),
    }
  }
}
