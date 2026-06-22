import { Marked } from "marked"

const safeProtocols = new Set(["http", "https", "mailto", "tel"])

const escapeHtml = (html: string): string =>
  html.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const escapeAttribute = (value: string): string => escapeHtml(value).replaceAll('"', "&quot;")

const characterReference = (codePoint: number): string =>
  Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : ""

const decodeCharacterReferences = (value: string): string =>
  value
    .replace(/&#(\d+);?/g, (_match, digits: string) => characterReference(Number(digits)))
    .replace(/&#x([\da-f]+);?/gi, (_match, digits: string) =>
      characterReference(Number.parseInt(digits, 16)),
    )
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n")

const whitespacePattern = /\s/u

const stripUnsafeUrlCharacters = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return (
        codePoint !== undefined &&
        codePoint > 0x1f &&
        codePoint !== 0x7f &&
        !whitespacePattern.test(character)
      )
    })
    .join("")

const safeHref = (href: string): string | undefined => {
  const trimmed = href.trim()
  if (trimmed.length === 0) return undefined

  const normalized = stripUnsafeUrlCharacters(decodeCharacterReferences(trimmed)).toLowerCase()
  const colonIndex = normalized.indexOf(":")
  const pathStartIndex = normalized.search(/[/?#]/)

  if (colonIndex !== -1 && (pathStartIndex === -1 || colonIndex < pathStartIndex)) {
    const protocol = normalized.slice(0, colonIndex)
    if (!safeProtocols.has(protocol)) return undefined
  }

  return trimmed
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      const safe = safeHref(href)
      if (safe === undefined) return label

      const titleAttribute =
        title === null || title === undefined ? "" : ` title="${escapeAttribute(title)}"`
      return `<a href="${escapeAttribute(safe)}"${titleAttribute}>${label}</a>`
    },
    image({ text }) {
      return escapeHtml(text)
    },
  },
})

export const renderMarkdown = (source: string): string => markdown.parse(source, { async: false })
