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

/** The MCP Apps host-context subset accepted by a generated surface mount. */
export interface HostContext {
  /** Current root color scheme. */
  readonly theme?: "light" | "dark"
  readonly styles?: {
    /** Trusted values for standardized MCP Apps CSS custom properties. */
    readonly variables?: Partial<Record<McpUiStyleVariableKey, string>>
  }
}

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

const hostContextKeys: ReadonlySet<string> = new Set(["theme", "styles"])
const hostStyleKeys: ReadonlySet<string> = new Set(["variables"])

export const parseHostContext = (value: unknown): HostContext => {
  if (!isRecord(value)) throw new TypeError("Host context must be an object.")
  assertOnlyKeys(value, hostContextKeys, "Host context")

  const theme = value.theme
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    throw new TypeError('Host context theme must be "light" or "dark".')
  }

  const styles = value.styles
  if (styles === undefined) return theme === undefined ? {} : { theme }
  if (!isRecord(styles)) throw new TypeError("Host context styles must be an object.")
  assertOnlyKeys(styles, hostStyleKeys, "Host context styles")

  const inputVariables = styles.variables
  if (inputVariables === undefined) {
    return { ...(theme === undefined ? {} : { theme }), styles: {} }
  }
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

  return {
    ...(theme === undefined ? {} : { theme }),
    styles: { variables },
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
