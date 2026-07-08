import { allowGenui0DataAttribute } from "./dialect/genui0.js"

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

const removeElementWithBody = (html: string, tag: string): string =>
  html
    .replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), "")
    .replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "gi"), "")

const removeElement = (html: string, tag: string): string =>
  html.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "")

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

const sanitizeDatastarAttributes = (
  html: string,
  grantedCapabilities: ReadonlySet<string>,
): string =>
  html.replace(
    /\s(data-[^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi,
    (_source, name: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const attribute = allowGenui0DataAttribute({
        name,
        value: doubleQuoted ?? singleQuoted ?? bare,
        grantedCapabilities,
      })
      return attribute === undefined
        ? ""
        : ` ${attribute.name}="${escapeAttribute(attribute.value)}"`
    },
  )

const sanitizeUrls = (html: string): string =>
  html.replace(
    /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_source, name: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const value = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim()
      return /^https:\/\//i.test(value) ? ` ${name}="${escapeAttribute(value)}"` : ""
    },
  )

const stripDirectSubmissionAttributes = (html: string): string =>
  html
    .replace(
      /\s(?:action|formaction|method|enctype|target|ping|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(/\s(?:download|formnovalidate)(?=[\s>])/gi, "")

const trimDanglingTag = (html: string): string => {
  const lastOpen = html.lastIndexOf("<")
  const lastClose = html.lastIndexOf(">")
  return lastOpen > lastClose ? html.slice(0, lastOpen) : html
}

const closeOpenTags = (html: string): string => {
  const stack: string[] = []

  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const source = match[0]
    const tag = match[1]?.toLowerCase()
    if (tag === undefined || source.startsWith("<!") || source.startsWith("<?")) continue
    if (voidTags.has(tag) || source.endsWith("/>")) continue

    if (!source.startsWith("</")) {
      stack.push(tag)
      continue
    }

    const index = stack.lastIndexOf(tag)
    if (index !== -1) stack.splice(index)
  }

  return html + stack.reduceRight((result, tag) => `${result}</${tag}>`, "")
}

export const sanitizeSurfaceHtml = (
  html: string,
  grantedCapabilities: ReadonlySet<string>,
): string => {
  let safe = html.replace(/<!--[\s\S]*?-->/g, "")

  for (const tag of ["script", "style", "iframe", "object", "embed", "template", "noscript"]) {
    safe = removeElementWithBody(safe, tag)
  }

  for (const tag of ["link", "meta", "base"]) {
    safe = removeElement(safe, tag)
  }

  safe = sanitizeUrls(safe)
  safe = stripDirectSubmissionAttributes(safe)
  safe = sanitizeDatastarAttributes(safe, grantedCapabilities)
  safe = safe
    .replace(/\s(?:on[a-z][\w:-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:on[a-z][\w:-]*)(?=[\s>])/gi, "")
  safe = trimDanglingTag(safe)
  return closeOpenTags(safe)
}
