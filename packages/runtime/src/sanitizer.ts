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

const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i
const bareIdentifierPattern = /^_?[A-Za-z][A-Za-z0-9_]*$/
const signalPathPattern = /^\$_?[A-Za-z][A-Za-z0-9_]*(?:\._?[A-Za-z][A-Za-z0-9_]*)*$/
const numberLiteralPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const stringLiteralPattern = /^(?:"[^"\\<>]*"|'[^'\\<>]*')$/
const primitiveLiteralPattern = /^(?:true|false|null)$/

interface CapabilityAction {
  readonly name: string
  readonly input: string
}

const splitOutsideQuotes = (source: string, separator: string): string[] | undefined => {
  const parts: string[] = []
  let quote: '"' | "'" | undefined
  let start = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === undefined) return undefined
    if (character === "\\") return undefined

    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if ("()[]{}".includes(character)) return undefined
    if (character === separator) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }

  if (quote !== undefined) return undefined
  parts.push(source.slice(start).trim())
  return parts.every((part) => part.length > 0) ? parts : undefined
}

const splitKeyValue = (entry: string): readonly [string, string] | undefined => {
  const parts = splitOutsideQuotes(entry, ":")
  return parts?.length === 2 && parts[0] !== undefined && parts[1] !== undefined
    ? [parts[0], parts[1]]
    : undefined
}

const isSafeObjectKey = (value: string): boolean =>
  bareIdentifierPattern.test(value) || stringLiteralPattern.test(value)

const isSafeScalarExpression = (value: string): boolean => {
  const source = value.trim()
  return (
    signalPathPattern.test(source) ||
    numberLiteralPattern.test(source) ||
    primitiveLiteralPattern.test(source) ||
    stringLiteralPattern.test(source)
  )
}

const isSafeObjectExpression = (value: string): boolean => {
  const source = value.trim()
  if (!source.startsWith("{") || !source.endsWith("}")) return false

  const body = source.slice(1, -1).trim()
  if (body.length === 0) return true

  const entries = splitOutsideQuotes(body, ",")
  if (entries === undefined) return false

  return entries.every((entry) => {
    const keyValue = splitKeyValue(entry)
    return (
      keyValue !== undefined && isSafeObjectKey(keyValue[0]) && isSafeScalarExpression(keyValue[1])
    )
  })
}

const isSafeSimpleExpression = (value: string): boolean =>
  value.length <= 1_200 && (isSafeScalarExpression(value) || isSafeObjectExpression(value))

const isSafeBindingExpression = (value: string): boolean => {
  const source = value.trim()
  return (
    source.length <= 1_200 && (bareIdentifierPattern.test(source) || signalPathPattern.test(source))
  )
}

const parseCapabilityAction = (value: string): CapabilityAction | undefined => {
  const match = /^@capability\(\s*(["'])([^"']+)\1\s*,\s*([\s\S]+)\s*\)$/.exec(value.trim())
  const name = match?.[2]
  const input = match?.[3]

  return name !== undefined && input !== undefined && capabilityNamePattern.test(name)
    ? { name, input }
    : undefined
}

const safeDatastarAttribute = (
  name: string,
  value: string | undefined,
  grantedCapabilities: ReadonlySet<string>,
): string => {
  const normalized = name.toLowerCase()
  if (value === undefined) return ""

  if (normalized === "data-on:click" || normalized === "data-on:submit__prevent") {
    const action = parseCapabilityAction(value)
    return action !== undefined &&
      grantedCapabilities.has(action.name) &&
      isSafeObjectExpression(action.input)
      ? ` ${name}="${escapeAttribute(value)}"`
      : ""
  }

  if (normalized === "data-signals") {
    return isSafeObjectExpression(value) ? ` ${name}="${escapeAttribute(value)}"` : ""
  }

  if (normalized === "data-bind") {
    return isSafeBindingExpression(value) ? ` ${name}="${escapeAttribute(value)}"` : ""
  }

  if (
    normalized === "data-show" ||
    normalized === "data-text" ||
    normalized === "data-class" ||
    normalized.startsWith("data-class:") ||
    normalized === "data-style" ||
    normalized.startsWith("data-style:") ||
    normalized.startsWith("data-attr:")
  ) {
    return isSafeSimpleExpression(value) ? ` ${name}="${escapeAttribute(value)}"` : ""
  }

  return ""
}

const sanitizeDatastarAttributes = (
  html: string,
  grantedCapabilities: ReadonlySet<string>,
): string =>
  html.replace(
    /\s(data-[^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi,
    (_source, name: string, doubleQuoted: string, singleQuoted: string, bare: string) =>
      safeDatastarAttribute(name, doubleQuoted ?? singleQuoted ?? bare, grantedCapabilities),
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
