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

const urlAttributeNames = new Set(["href", "src", "srcset", "action", "formaction", "poster"])

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

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
    .replace(/&amp;/gi, "&")

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

const removeElementWithBody = (html: string, tag: string): string =>
  html
    .replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), "")
    .replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "gi"), "")

const removeElement = (html: string, tag: string): string =>
  html.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "")

const sanitizeCss = (css: string): string =>
  css
    .replace(/@import\b[^;]*(;|$)/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/behavior\s*:/gi, "")

const sanitizeStyleAttributes = (html: string): string =>
  html.replace(
    /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_match, double, single, bare) => {
      const css = sanitizeCss(double ?? single ?? bare ?? "").trim()
      return css.length === 0 ? "" : ` style="${escapeAttribute(css)}"`
    },
  )

const datastarAttributePattern = /\s(data-[^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi

const htmlAttributePattern = /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const signalNamePattern = /^_?[A-Za-z][A-Za-z0-9_]*(\._?[A-Za-z][A-Za-z0-9_]*)*$/
const actionNamePattern = /^[A-Za-z_$][\w$]*$/
const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i

const unsafeExpressionPattern =
  /[;]|url\s*\(|javascript\s*:|\b(?:window|document|globalThis|fetch|XMLHttpRequest|eval|Function|import|location|cookie|localStorage|sessionStorage|alert|setTimeout|setInterval|navigator|history)\b/i

const isSafeDatastarExpression = (value: string): boolean =>
  value.length <= 1_200 && !unsafeExpressionPattern.test(value)

const isLocalSignalAssignment = (value: string): boolean =>
  /^\s*\$_[A-Za-z][A-Za-z0-9_]*(?:\._?[A-Za-z][A-Za-z0-9_]*)*\s*=\s*(?:"[^"]*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?)\s*$/.test(
    value,
  )

const isChatPostAction = (value: string): boolean => {
  const source = value.trim()
  return (
    isSafeDatastarExpression(source) &&
    /^@post\(\s*(["'])\/chat\1\s*,/.test(source) &&
    /\bpayload\s*:/.test(source) &&
    /\bchatId\s*:/.test(source) &&
    /\bprompt\s*:/.test(source)
  )
}

export interface GeneratedHtmlOptions {
  readonly allowedCapabilities?: ReadonlySet<string>
  readonly allowedActions?: ReadonlySet<string>
  readonly allowedPluginAttributes?: ReadonlySet<string>
}

const defaultAllowedCapabilities = new Set(["chat.follow_up"])
const emptyAllowedActions = new Set<string>()
const emptyAllowedPluginAttributes = new Set<string>()

const capabilityNameFromAction = (value: string): string | undefined => {
  const source = value.trim()
  const match = /^@capability\(\s*(["'])([^"']+)\1\s*,/.exec(source)
  const capability = match?.[2]
  return capability !== undefined && capabilityNamePattern.test(capability) ? capability : undefined
}

const isCapabilityAction = (value: string, allowedCapabilities: ReadonlySet<string>): boolean => {
  const source = value.trim()
  const capability = capabilityNameFromAction(source)
  return (
    capability !== undefined &&
    allowedCapabilities.has(capability) &&
    isSafeDatastarExpression(source)
  )
}

const isAllowedActionCall = (value: string, allowedActions: ReadonlySet<string>): boolean => {
  const source = value.trim()
  const match = /^@([A-Za-z_$][\w$]*)\(/.exec(source)
  const name = match?.[1]
  return (
    name !== undefined &&
    actionNamePattern.test(name) &&
    allowedActions.has(name) &&
    isSafeDatastarExpression(source)
  )
}

const renderDatastarAttribute = (name: string, value: string | undefined): string =>
  value === undefined ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`

const sanitizeDatastarAttribute = (
  options: Required<GeneratedHtmlOptions>,
  match: string,
  name: string,
  doubleQuoted: string | undefined,
  singleQuoted: string | undefined,
  bare: string | undefined,
): string => {
  const normalizedName = name.toLowerCase()
  const value = doubleQuoted ?? singleQuoted ?? bare
  const allowedPluginAttributes = options.allowedPluginAttributes

  if (normalizedName === "data-bind") {
    return value !== undefined && signalNamePattern.test(value)
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (normalizedName.startsWith("data-bind:")) {
    const signalName = normalizedName.slice("data-bind:".length)
    return signalNamePattern.test(signalName) ? match : ""
  }

  if (allowedPluginAttributes.has(normalizedName)) {
    return value !== undefined && isSafeDatastarExpression(value)
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (normalizedName === "data-signals") {
    return value !== undefined && isSafeDatastarExpression(value)
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (normalizedName === "data-on:submit__prevent") {
    return value !== undefined &&
      (isChatPostAction(value) || isCapabilityAction(value, options.allowedCapabilities))
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (normalizedName === "data-on:click") {
    return value !== undefined &&
      (isChatPostAction(value) ||
        isCapabilityAction(value, options.allowedCapabilities) ||
        isAllowedActionCall(value, options.allowedActions) ||
        isLocalSignalAssignment(value))
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (normalizedName === "data-effect") {
    return value !== undefined && isAllowedActionCall(value, options.allowedActions)
      ? renderDatastarAttribute(name, value)
      : ""
  }

  if (
    normalizedName === "data-show" ||
    normalizedName === "data-text" ||
    normalizedName === "data-class" ||
    normalizedName.startsWith("data-class:") ||
    normalizedName === "data-style" ||
    normalizedName.startsWith("data-style:") ||
    normalizedName === "data-attr:disabled" ||
    normalizedName === "data-attr:aria-expanded" ||
    normalizedName === "data-attr:aria-pressed" ||
    normalizedName === "data-attr:aria-selected" ||
    normalizedName === "data-attr:aria-label" ||
    normalizedName === "data-attr:title"
  ) {
    return value !== undefined && isSafeDatastarExpression(value)
      ? renderDatastarAttribute(name, value)
      : ""
  }

  return ""
}

const safeRemoteUrl = (value: string): string | undefined => {
  const normalized = stripUnsafeUrlCharacters(decodeCharacterReferences(value).trim())
  if (normalized.length === 0) return undefined

  try {
    const url = new URL(normalized)
    return url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

const renderStaticAttribute = (name: string, value: string | undefined): string =>
  value === undefined ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`

const sanitizeUrlAttributes = (html: string): string =>
  html.replace(/<([a-z][a-z0-9-]*)(\s[^<>]*?)?>/gi, (match, tagName: string, attrs = "") => {
    if (match.startsWith("</")) return match

    const tag = tagName.toLowerCase()
    let output = ""
    let hasSafeImageSrc = false
    let hasImageAlt = false
    let hasSafeAnchorHref = false

    for (const attr of attrs.matchAll(htmlAttributePattern)) {
      const name = attr[1]
      if (name === undefined || name === "/") continue

      const normalizedName = name.toLowerCase()
      const value = attr[2] ?? attr[3] ?? attr[4]

      if (normalizedName.startsWith("on")) continue
      if (urlAttributeNames.has(normalizedName)) {
        if (normalizedName === "src" && tag === "img" && value !== undefined) {
          const src = safeRemoteUrl(value)
          if (src !== undefined) {
            output += renderStaticAttribute(name, src)
            hasSafeImageSrc = true
          }
        }

        if (normalizedName === "href" && tag === "a" && value !== undefined) {
          const href = safeRemoteUrl(value)
          if (href !== undefined) {
            output += renderStaticAttribute(name, href)
            hasSafeAnchorHref = true
          }
        }

        continue
      }

      if (tag === "a" && (normalizedName === "target" || normalizedName === "rel")) continue
      if (
        tag === "img" &&
        (normalizedName === "loading" ||
          normalizedName === "decoding" ||
          normalizedName === "referrerpolicy")
      ) {
        continue
      }

      if (tag === "img" && normalizedName === "alt") hasImageAlt = true
      output += renderStaticAttribute(name, value)
    }

    if (tag === "img" && hasSafeImageSrc) {
      if (!hasImageAlt) output += ' alt=""'
      output += ' loading="lazy" decoding="async" referrerpolicy="no-referrer"'
    }

    if (tag === "a" && hasSafeAnchorHref) {
      output += ' target="_blank" rel="noopener noreferrer"'
    }

    return `<${tagName}${output}>`
  })

const removeDangerousAttributes = (html: string, options: Required<GeneratedHtmlOptions>): string =>
  html
    .replace(datastarAttributePattern, (...args) =>
      sanitizeDatastarAttribute(
        options,
        args[0] as string,
        args[1] as string,
        args[2] as string | undefined,
        args[3] as string | undefined,
        args[4] as string | undefined,
      ),
    )
    .replace(
      /\s(?:on[a-z][\w:-]*|srcset|action|formaction|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(/\s(?:on[a-z][\w:-]*|srcset|action|formaction|poster)(?=[\s>])/gi, "")

const trimDanglingTag = (html: string): string => {
  const lastOpen = html.lastIndexOf("<")
  const lastClose = html.lastIndexOf(">")
  return lastOpen > lastClose ? html.slice(0, lastOpen) : html
}

const closeOpenTags = (html: string): string => {
  const stack: string[] = []
  const tags = html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)

  for (const match of tags) {
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

  return html + stack.reduceRight((closingTags, tag) => `${closingTags}</${tag}>`, "")
}

const normalizeOptions = (
  options: GeneratedHtmlOptions | undefined,
): Required<GeneratedHtmlOptions> => ({
  allowedCapabilities: options?.allowedCapabilities ?? defaultAllowedCapabilities,
  allowedActions: options?.allowedActions ?? emptyAllowedActions,
  allowedPluginAttributes: options?.allowedPluginAttributes ?? emptyAllowedPluginAttributes,
})

export const renderGeneratedHtml = (html: string, options?: GeneratedHtmlOptions): string => {
  const normalizedOptions = normalizeOptions(options)
  let safe = html.replace(/<!--[\s\S]*?-->/g, "")

  for (const tag of ["script", "style", "iframe", "object", "embed", "template", "noscript"]) {
    safe = removeElementWithBody(safe, tag)
  }

  for (const tag of ["link", "meta", "base"]) {
    safe = removeElement(safe, tag)
  }

  safe = sanitizeUrlAttributes(safe)
  safe = removeDangerousAttributes(safe, normalizedOptions)
  safe = sanitizeStyleAttributes(safe)
  safe = trimDanglingTag(safe)
  return closeOpenTags(safe)
}
