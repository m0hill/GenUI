import { Hono } from "hono"
import { SITE_URL } from "../constants"
import { docPages } from "../generated/docs"
import { sidebar } from "../pages/docs/nav"
import type { Env } from "../server"
import { markdownResponse } from "./markdown"
import { SKILL_DESCRIPTION, SKILL_MD, SKILL_NAME } from "./skill"

const staticPaths = ["/", "/playground"] as const

const sitePaths = [...staticPaths, ...docPages.map((page) => page.path)]

const text = (body: string): Response =>
  new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" }
  })

const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot-Extended",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "DuckAssistBot",
  "MistralAI-User"
]

const robotsTxt = [
  "# robots.txt for datastar-kit.dev",
  "",
  "User-agent: *",
  "Allow: /",
  "# Content usage preferences — https://contentsignals.org/",
  "Content-Signal: ai-train=yes, search=yes, ai-input=yes",
  "",
  "# AI crawlers — training, search, and AI answers all welcome.",
  ...aiCrawlers.map((bot) => `User-agent: ${bot}`),
  "Allow: /",
  "",
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  ""
].join("\n")

const sitemapXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitePaths.map((path) => {
    const loc = `${SITE_URL}${path === "/" ? "" : path}`
    return `  <url>\n    <loc>${loc}</loc>\n  </url>`
  }),
  "</urlset>",
  ""
].join("\n")

const descriptionByPath = new Map(docPages.map((page) => [page.path, page.description]))

const llmsLines = [
  "# Datastar Kit",
  "",
  "> A small TypeScript SDK for building server-driven UI with Datastar: typed",
  "> attributes, server-rendered TSX, and native Response helpers. Runs on any",
  "> Fetch-compatible runtime (Hono, Cloudflare Workers, Bun, Deno, Node.js).",
  "",
  "Datastar Kit is a kit, not a framework. It owns the Datastar-shaped pieces —",
  "typed attributes and actions, response helpers, and signal decoding — and",
  "leaves the rest of your app to you.",
  ""
]

for (const group of sidebar) {
  llmsLines.push(`## ${group.text}`, "")
  for (const item of group.items) {
    const description = descriptionByPath.get(item.path) ?? ""
    const url = `${SITE_URL}${item.path}`
    llmsLines.push(
      description === "" ? `- [${item.text}](${url})` : `- [${item.text}](${url}): ${description}`
    )
  }
  llmsLines.push("")
}

const llmsTxt = llmsLines.join("\n")

const skillUrl = `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`

let cachedDigest: string | undefined

const skillDigest = async (): Promise<string> => {
  if (cachedDigest === undefined) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SKILL_MD))
    const hex = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
    cachedDigest = `sha256:${hex}`
  }
  return cachedDigest
}

const skillsIndex = async (): Promise<string> =>
  `${JSON.stringify(
    {
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: SKILL_NAME,
          type: "skill-md",
          description: SKILL_DESCRIPTION,
          url: skillUrl,
          digest: await skillDigest()
        }
      ]
    },
    null,
    2
  )}\n`

const agents = new Hono<Env>()

agents.get("/robots.txt", () => text(robotsTxt))
agents.get("/llms.txt", () => text(llmsTxt))
agents.get(
  "/sitemap.xml",
  () =>
    new Response(sitemapXml, {
      headers: { "content-type": "application/xml; charset=utf-8" }
    })
)
agents.get(skillUrl, () => markdownResponse(SKILL_MD))
agents.get(
  "/.well-known/agent-skills/index.json",
  async () =>
    new Response(await skillsIndex(), {
      headers: { "content-type": "application/json; charset=utf-8" }
    })
)

export default agents
