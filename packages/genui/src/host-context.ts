/** CSS variable keys standardized by MCP Apps SEP-1865, specification 2026-01-26. */
export type McpUiStyleVariableKey =
  // Background colors
  | "--color-background-primary"
  | "--color-background-secondary"
  | "--color-background-tertiary"
  | "--color-background-inverse"
  | "--color-background-ghost"
  | "--color-background-info"
  | "--color-background-danger"
  | "--color-background-success"
  | "--color-background-warning"
  | "--color-background-disabled"
  // Text colors
  | "--color-text-primary"
  | "--color-text-secondary"
  | "--color-text-tertiary"
  | "--color-text-inverse"
  | "--color-text-ghost"
  | "--color-text-info"
  | "--color-text-danger"
  | "--color-text-success"
  | "--color-text-warning"
  | "--color-text-disabled"
  // Border colors
  | "--color-border-primary"
  | "--color-border-secondary"
  | "--color-border-tertiary"
  | "--color-border-inverse"
  | "--color-border-ghost"
  | "--color-border-info"
  | "--color-border-danger"
  | "--color-border-success"
  | "--color-border-warning"
  | "--color-border-disabled"
  // Ring colors
  | "--color-ring-primary"
  | "--color-ring-secondary"
  | "--color-ring-inverse"
  | "--color-ring-info"
  | "--color-ring-danger"
  | "--color-ring-success"
  | "--color-ring-warning"
  // Typography - Family
  | "--font-sans"
  | "--font-mono"
  // Typography - Weight
  | "--font-weight-normal"
  | "--font-weight-medium"
  | "--font-weight-semibold"
  | "--font-weight-bold"
  // Typography - Text Size
  | "--font-text-xs-size"
  | "--font-text-sm-size"
  | "--font-text-md-size"
  | "--font-text-lg-size"
  // Typography - Heading Size
  | "--font-heading-xs-size"
  | "--font-heading-sm-size"
  | "--font-heading-md-size"
  | "--font-heading-lg-size"
  | "--font-heading-xl-size"
  | "--font-heading-2xl-size"
  | "--font-heading-3xl-size"
  // Typography - Text Line Height
  | "--font-text-xs-line-height"
  | "--font-text-sm-line-height"
  | "--font-text-md-line-height"
  | "--font-text-lg-line-height"
  // Typography - Heading Line Height
  | "--font-heading-xs-line-height"
  | "--font-heading-sm-line-height"
  | "--font-heading-md-line-height"
  | "--font-heading-lg-line-height"
  | "--font-heading-xl-line-height"
  | "--font-heading-2xl-line-height"
  | "--font-heading-3xl-line-height"
  // Border radius
  | "--border-radius-xs"
  | "--border-radius-sm"
  | "--border-radius-md"
  | "--border-radius-lg"
  | "--border-radius-xl"
  | "--border-radius-full"
  // Border width
  | "--border-width-regular"
  // Shadows
  | "--shadow-hairline"
  | "--shadow-sm"
  | "--shadow-md"
  | "--shadow-lg"

/** Ordered runtime allowlist for validating and rendering standardized variables. */
export const mcpUiStyleVariableKeys = [
  // Background colors
  "--color-background-primary",
  "--color-background-secondary",
  "--color-background-tertiary",
  "--color-background-inverse",
  "--color-background-ghost",
  "--color-background-info",
  "--color-background-danger",
  "--color-background-success",
  "--color-background-warning",
  "--color-background-disabled",
  // Text colors
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-inverse",
  "--color-text-ghost",
  "--color-text-info",
  "--color-text-danger",
  "--color-text-success",
  "--color-text-warning",
  "--color-text-disabled",
  // Border colors
  "--color-border-primary",
  "--color-border-secondary",
  "--color-border-tertiary",
  "--color-border-inverse",
  "--color-border-ghost",
  "--color-border-info",
  "--color-border-danger",
  "--color-border-success",
  "--color-border-warning",
  "--color-border-disabled",
  // Ring colors
  "--color-ring-primary",
  "--color-ring-secondary",
  "--color-ring-inverse",
  "--color-ring-info",
  "--color-ring-danger",
  "--color-ring-success",
  "--color-ring-warning",
  // Typography - Family
  "--font-sans",
  "--font-mono",
  // Typography - Weight
  "--font-weight-normal",
  "--font-weight-medium",
  "--font-weight-semibold",
  "--font-weight-bold",
  // Typography - Text Size
  "--font-text-xs-size",
  "--font-text-sm-size",
  "--font-text-md-size",
  "--font-text-lg-size",
  // Typography - Heading Size
  "--font-heading-xs-size",
  "--font-heading-sm-size",
  "--font-heading-md-size",
  "--font-heading-lg-size",
  "--font-heading-xl-size",
  "--font-heading-2xl-size",
  "--font-heading-3xl-size",
  // Typography - Text Line Height
  "--font-text-xs-line-height",
  "--font-text-sm-line-height",
  "--font-text-md-line-height",
  "--font-text-lg-line-height",
  // Typography - Heading Line Height
  "--font-heading-xs-line-height",
  "--font-heading-sm-line-height",
  "--font-heading-md-line-height",
  "--font-heading-lg-line-height",
  "--font-heading-xl-line-height",
  "--font-heading-2xl-line-height",
  "--font-heading-3xl-line-height",
  // Border radius
  "--border-radius-xs",
  "--border-radius-sm",
  "--border-radius-md",
  "--border-radius-lg",
  "--border-radius-xl",
  "--border-radius-full",
  // Border width
  "--border-width-regular",
  // Shadows
  "--shadow-hairline",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
] as const satisfies readonly McpUiStyleVariableKey[]

type MissingStyleVariableKey = Exclude<
  McpUiStyleVariableKey,
  (typeof mcpUiStyleVariableKeys)[number]
>
// Keep the runtime allowlist complete when the copied SEP union changes.
const includesEveryStyleVariableKey: MissingStyleVariableKey extends never ? true : never = true
void includesEveryStyleVariableKey

type HeightDimensions =
  | {
      readonly height: number
      readonly maxHeight?: never
    }
  | {
      readonly height?: never
      readonly maxHeight?: number
    }

type WidthDimensions =
  | {
      readonly width: number
      readonly maxWidth?: never
    }
  | {
      readonly width?: never
      readonly maxWidth?: number
    }

/** Independent fixed or flexible pixel constraints for each surface axis. */
export type ContainerDimensions = HeightDimensions & WidthDimensions

/** The MCP Apps host-context subset accepted by a generated surface mount. */
export interface HostContext {
  /** Current root color scheme. */
  readonly theme?: "light" | "dark"
  readonly styles?: {
    /** Trusted values for standardized MCP Apps CSS custom properties. */
    readonly variables?: Partial<Record<McpUiStyleVariableKey, string>>
  }
  /** Fixed or flexible iframe dimensions in CSS pixels. */
  readonly containerDimensions?: ContainerDimensions
  /** BCP-47 language and region preference. */
  readonly locale?: string
  /** Time-zone preference accepted by Intl.DateTimeFormat. */
  readonly timeZone?: string
  /** Host platform category for small surface adaptations. */
  readonly platform?: "web" | "desktop" | "mobile"
}

/** Host context fields exposed to generated JavaScript. Trusted CSS variables stay CSS-only. */
export type GuestHostContext = Readonly<
  Pick<HostContext, "theme" | "containerDimensions" | "locale" | "timeZone" | "platform">
>

const styleVariableKeys: ReadonlySet<string> = new Set(mcpUiStyleVariableKeys)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStyleVariableKey = (value: string): value is McpUiStyleVariableKey =>
  styleVariableKeys.has(value)

const assertOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path} contains unsupported key ${key}.`)
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key) && value[key] !== undefined) {
      throw new TypeError(`${path} contains inherited key ${key}.`)
    }
  }
}

const assertSafeCssValue = (key: McpUiStyleVariableKey, value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Host style variable ${key} must be a non-empty string.`)
  }

  const blocks: string[] = []
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      throw new TypeError(`Host style variable ${key} contains a control character.`)
    }
    if (character === "<" || character === ">" || character === "{" || character === "}") {
      throw new TypeError(`Host style variable ${key} contains unsafe CSS.`)
    }

    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "(") {
      blocks.push(")")
      continue
    }
    if (character === "[") {
      blocks.push("]")
      continue
    }
    if (character === ")" || character === "]") {
      if (blocks.pop() !== character) {
        throw new TypeError(`Host style variable ${key} contains invalid CSS blocks.`)
      }
      continue
    }
    if (character === ";" && blocks.length === 0) {
      throw new TypeError(`Host style variable ${key} contains a top-level semicolon.`)
    }
  }

  if (escaped || quote !== undefined || blocks.length > 0) {
    throw new TypeError(`Host style variable ${key} contains incomplete CSS.`)
  }
  return value
}

const hostContextKeys: ReadonlySet<string> = new Set([
  "theme",
  "styles",
  "containerDimensions",
  "locale",
  "timeZone",
  "platform",
])
const hostStyleKeys: ReadonlySet<string> = new Set(["variables"])
const containerDimensionKeys: ReadonlySet<string> = new Set([
  "height",
  "maxHeight",
  "width",
  "maxWidth",
])
const maxLocaleTimeZoneLength = 128

const parseDimensionValue = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Host context ${name} must be a finite non-negative number.`)
  }
  return value
}

const parseContainerDimensions = (value: unknown): ContainerDimensions => {
  if (!isRecord(value)) throw new TypeError("Host context containerDimensions must be an object.")
  assertOnlyKeys(value, containerDimensionKeys, "Host context containerDimensions")

  const hasHeight = Object.hasOwn(value, "height")
  const hasMaxHeight = Object.hasOwn(value, "maxHeight")
  const hasWidth = Object.hasOwn(value, "width")
  const hasMaxWidth = Object.hasOwn(value, "maxWidth")
  if (hasHeight && hasMaxHeight) {
    throw new TypeError("Host context containerDimensions cannot contain height and maxHeight.")
  }
  if (hasWidth && hasMaxWidth) {
    throw new TypeError("Host context containerDimensions cannot contain width and maxWidth.")
  }

  const heightDimensions: HeightDimensions = hasHeight
    ? { height: parseDimensionValue(value.height, "containerDimensions.height") }
    : hasMaxHeight
      ? { maxHeight: parseDimensionValue(value.maxHeight, "containerDimensions.maxHeight") }
      : {}
  const widthDimensions: WidthDimensions = hasWidth
    ? { width: parseDimensionValue(value.width, "containerDimensions.width") }
    : hasMaxWidth
      ? { maxWidth: parseDimensionValue(value.maxWidth, "containerDimensions.maxWidth") }
      : {}
  return { ...heightDimensions, ...widthDimensions }
}

const parseLocale = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0 || value.length > maxLocaleTimeZoneLength) {
    throw new TypeError(
      `Host context locale must be a non-empty string of at most ${maxLocaleTimeZoneLength} characters.`,
    )
  }
  try {
    Intl.getCanonicalLocales(value)
  } catch {
    throw new TypeError("Host context locale must be a valid BCP-47 locale.")
  }
  return value
}

const parseTimeZone = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0 || value.length > maxLocaleTimeZoneLength) {
    throw new TypeError(
      `Host context timeZone must be a non-empty string of at most ${maxLocaleTimeZoneLength} characters.`,
    )
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
  } catch {
    throw new TypeError("Host context timeZone must be accepted by Intl.DateTimeFormat.")
  }
  return value
}

export const parseHostContext = (value: unknown): HostContext => {
  if (!isRecord(value)) throw new TypeError("Host context must be an object.")
  assertOnlyKeys(value, hostContextKeys, "Host context")

  const theme = value.theme
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    throw new TypeError('Host context theme must be "light" or "dark".')
  }

  const containerDimensions =
    value.containerDimensions === undefined
      ? undefined
      : parseContainerDimensions(value.containerDimensions)
  const locale = parseLocale(value.locale)
  const timeZone = parseTimeZone(value.timeZone)
  const platform = value.platform
  if (
    platform !== undefined &&
    platform !== "web" &&
    platform !== "desktop" &&
    platform !== "mobile"
  ) {
    throw new TypeError('Host context platform must be "web", "desktop", or "mobile".')
  }

  const styles = value.styles
  let parsedStyles: HostContext["styles"]
  if (styles !== undefined) {
    if (!isRecord(styles)) throw new TypeError("Host context styles must be an object.")
    assertOnlyKeys(styles, hostStyleKeys, "Host context styles")

    const inputVariables = styles.variables
    if (inputVariables === undefined) {
      parsedStyles = {}
    } else {
      if (!isRecord(inputVariables)) {
        throw new TypeError("Host context style variables must be an object.")
      }

      const variables: Partial<Record<McpUiStyleVariableKey, string>> = {}
      for (const [key, inputValue] of Object.entries(inputVariables)) {
        if (!isStyleVariableKey(key)) {
          throw new TypeError(`Unsupported MCP Apps style variable ${key}.`)
        }
        variables[key] = assertSafeCssValue(key, inputValue)
      }
      parsedStyles = { variables }
    }
  }

  return {
    ...(theme === undefined ? {} : { theme }),
    ...(parsedStyles === undefined ? {} : { styles: parsedStyles }),
    ...(containerDimensions === undefined ? {} : { containerDimensions }),
    ...(locale === undefined ? {} : { locale }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(platform === undefined ? {} : { platform }),
  }
}

export const renderHostStyleVariables = (hostContext: HostContext): string => {
  const variables = hostContext.styles?.variables
  if (variables === undefined) return ""

  const declarations: string[] = []
  for (const key of mcpUiStyleVariableKeys) {
    const value = variables[key]
    if (value !== undefined) declarations.push(`  ${key}: ${value};`)
  }
  return declarations.length === 0 ? "" : `<style>:root {\n${declarations.join("\n")}\n}</style>\n`
}
