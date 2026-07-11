import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { watch } from "node:fs"
import path from "node:path"
import process from "node:process"
import MarkdownIt from "markdown-it"
import anchor from "markdown-it-anchor"
import { createHighlighter, type Highlighter } from "shiki"
import type Token from "markdown-it/lib/token.mjs"
import { h, renderToString, unsafeHtml } from "datastar-kit"
import { SITE_URL } from "../src/constants"

const websiteRoot = path.resolve(import.meta.dirname, "..")
const contentDir = path.join(websiteRoot, "content")
const snippetsDir = path.join(contentDir, "snippets")
const outDir = path.join(websiteRoot, "src", "generated")

const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const

const FENCE_LANGS = [
  "tsx",
  "ts",
  "typescript",
  "json",
  "jsonc",
  "sh",
  "shellscript",
  "html",
  "css",
  "diff",
  "http",
  "nginx",
  "markdown",
  "text"
] as const

const langAliases: Record<string, string> = {
  md: "markdown",
  bash: "shellscript",
  shell: "shellscript",
  txt: "text"
}

interface DocHeading {
  level: 2 | 3
  text: string
  slug: string
}

interface DocSection {
  heading: string
  slug: string
  text: string
}

interface DocPage {
  slug: string
  path: string
  title: string
  description: string
  html: string
  markdown: string
  headings: DocHeading[]
  sections: DocSection[]
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s.-]/g, "")
    .replace(/[\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

const docPathFromFile = (relativeFile: string): string => {
  const slug = relativeFile
    .replace(/\\/g, "/")
    .replace(/\.md$/, "")
    .replace(/(^|\/)index$/, "")
  return slug === "" ? "/" : `/${slug}`
}

const rewriteDocLink = (href: string, currentDir: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
    return href
  }
  const hashIndex = href.indexOf("#")
  const file = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex)
  if (!file.endsWith(".md")) {
    return href
  }
  const resolved = path.posix.normalize(path.posix.join(currentDir, file))
  return docPathFromFile(resolved) + hash
}

const rewriteMarkdownLinks = (source: string, currentDir: string): string =>
  source.replace(/(\]\()([^)\s]+)/g, (_match, open: string, href: string) => {
    const rewritten = rewriteDocLink(href, currentDir)
    return `${open}${rewritten.startsWith("/") ? `${SITE_URL}${rewritten}` : rewritten}`
  })

const COPY_EXPRESSION =
  "const btn = evt.currentTarget;" +
  " navigator.clipboard.writeText(btn.closest('figure').querySelector('pre').innerText);" +
  " btn.classList.add('copied');" +
  " setTimeout(() => btn.classList.remove('copied'), 1200)"

const icon = (className: string, ...paths: readonly ReturnType<typeof h>[]): ReturnType<typeof h> =>
  h(
    "svg",
    {
      class: className,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    },
    ...paths
  )

const copyIcon = icon(
  "icon-copy",
  h("rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }),
  h("path", { d: "M5 15V6a2 2 0 0 1 2-2h9" })
)

const checkIcon = icon("icon-check", h("path", { d: "M5 12.5 10 17l9-10" }))

const highlightFence = (highlighter: Highlighter, code: string, lang: string): string => {
  const requested = langAliases[lang] ?? lang
  const language = (FENCE_LANGS as readonly string[]).includes(requested) ? requested : "text"
  const highlighted = highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang: language,
    themes: SHIKI_THEMES,
    defaultColor: "light"
  })
  const label = lang === "" ? "text" : lang
  const figure = h(
    "figure",
    { class: "code-block" },
    h(
      "figcaption",
      { class: "code-block-bar" },
      h("span", {}, label),
      h(
        "button",
        {
          type: "button",
          class: "code-copy",
          "aria-label": "Copy code",
          "data-on:click": COPY_EXPRESSION
        },
        copyIcon,
        checkIcon
      )
    ),
    unsafeHtml(highlighted)
  )
  return `${renderToString(figure)}\n`
}

const createRenderer = (highlighter: Highlighter, currentDir: string): MarkdownIt => {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    highlight: null
  })

  md.use(anchor, {
    level: [2, 3],
    slugify,
    permalink: anchor.permalink.headerLink({ safariReaderFix: true })
  })

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    if (token === undefined) {
      return ""
    }
    return highlightFence(highlighter, token.content, token.info.trim())
  }

  md.renderer.rules.table_open = () => '<div class="doc-table">\n<table>\n'
  md.renderer.rules.table_close = () => "</table>\n</div>\n"

  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token?.attrGet("href") ?? null
    if (token !== undefined && href !== null) {
      token.attrSet("href", rewriteDocLink(href, currentDir))
      if (/^https?:\/\//.test(href)) {
        token.attrSet("target", "_blank")
        token.attrSet("rel", "noreferrer")
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return md
}

const inlineText = (token: Token): string => {
  if (token.children === null) {
    return token.content
  }
  return token.children
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("")
}

interface ExtractedMeta {
  title: string
  description: string
  headings: DocHeading[]
  sections: DocSection[]
}

const extractMeta = (tokens: Token[], fallbackTitle: string): ExtractedMeta => {
  let title = fallbackTitle
  let description = ""
  const headings: DocHeading[] = []
  const sections: DocSection[] = []
  let current: DocSection = { heading: "", slug: "", text: "" }
  let headingLevel: string | null = null
  let headingBuffer = ""

  const pushSection = () => {
    current.text = current.text.replace(/\s+/g, " ").trim()
    if (current.heading !== "" || current.text !== "") {
      sections.push(current)
    }
  }

  for (const token of tokens) {
    if (token.type === "heading_open") {
      headingLevel = token.tag
      headingBuffer = ""
      continue
    }
    if (token.type === "heading_close") {
      const text = headingBuffer.trim()
      if (headingLevel === "h1" && title === fallbackTitle) {
        title = text
      } else if (headingLevel === "h2" || headingLevel === "h3") {
        const heading: DocHeading = {
          level: headingLevel === "h2" ? 2 : 3,
          text,
          slug: slugify(text)
        }
        headings.push(heading)
        if (heading.level === 2) {
          pushSection()
          current = { heading: heading.text, slug: heading.slug, text: "" }
        }
      }
      headingLevel = null
      continue
    }
    if (token.type !== "inline") {
      continue
    }
    const text = inlineText(token)
    if (headingLevel !== null) {
      headingBuffer += text
      continue
    }
    if (description === "" && text.trim() !== "") {
      description = text.replace(/\s+/g, " ").trim()
    }
    current.text += ` ${text}`
  }

  pushSection()
  return { title, description, headings, sections }
}

const listMarkdownFiles = async (dir: string, base = dir): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (full === snippetsDir) continue
      files.push(...(await listMarkdownFiles(full, base)))
    } else if (entry.name.endsWith(".md")) {
      files.push(path.relative(base, full))
    }
  }
  return files.toSorted()
}

const buildPages = async (highlighter: Highlighter): Promise<DocPage[]> => {
  const files = await listMarkdownFiles(contentDir)
  const pages: DocPage[] = []
  for (const file of files) {
    const source = await readFile(path.join(contentDir, file), "utf8")
    const currentDir = path.posix.dirname(file.replace(/\\/g, "/"))
    const md = createRenderer(highlighter, currentDir === "." ? "" : currentDir)
    const tokens = md.parse(source, {})
    const slug = file.replace(/\\/g, "/").replace(/\.md$/, "")
    const meta = extractMeta(tokens, slug)
    pages.push({
      slug,
      path: docPathFromFile(file),
      title: meta.title,
      description: meta.description,
      html: md.renderer.render(tokens, md.options, {}),
      markdown: rewriteMarkdownLinks(source, currentDir === "." ? "" : currentDir),
      headings: meta.headings,
      sections: meta.sections
    })
  }
  return pages
}

const buildSnippets = async (highlighter: Highlighter): Promise<Record<string, string>> => {
  const snippets: Record<string, string> = {}
  let entries: string[]
  try {
    entries = await readdir(snippetsDir)
  } catch {
    return snippets
  }
  for (const entry of entries.toSorted()) {
    const source = await readFile(path.join(snippetsDir, entry), "utf8")
    const lang = path.extname(entry).slice(1)
    const name = path.basename(entry, path.extname(entry))
    snippets[name] = highlightFence(highlighter, source, lang)
  }
  return snippets
}

const generate = async (highlighter: Highlighter): Promise<void> => {
  const pages = await buildPages(highlighter)
  const snippets = await buildSnippets(highlighter)
  await mkdir(outDir, { recursive: true })
  const header = "// Generated by scripts/build-docs.ts. Do not edit.\n"
  await writeFile(
    path.join(outDir, "docs.ts"),
    `${header}import type { DocPage } from "../pages/docs/types"\n\n` +
      `export const docPages: readonly DocPage[] = ${JSON.stringify(pages, null, 2)}\n\n` +
      `export const snippets: Record<string, string> = ${JSON.stringify(snippets, null, 2)}\n`
  )
  console.log(`docs: compiled ${pages.length} pages, ${Object.keys(snippets).length} snippets`)
}

const main = async () => {
  const highlighter = await createHighlighter({
    themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
    langs: [...FENCE_LANGS]
  })
  await generate(highlighter)

  if (!process.argv.includes("--watch")) {
    highlighter.dispose()
    return
  }

  console.log("docs: watching content/ for changes")
  let pending: ReturnType<typeof setTimeout> | undefined
  watch(contentDir, { recursive: true }, () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      generate(highlighter).catch((error) => console.error("docs: rebuild failed", error))
    }, 100)
  })
}

await main()
