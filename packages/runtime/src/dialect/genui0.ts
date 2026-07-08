import { genuiDialect, type CapabilityDescriptor } from "../types.js"

interface Genui0DataAttribute {
  readonly name: string
  readonly value: string | undefined
  readonly grantedCapabilities: ReadonlySet<string>
}

interface AllowedGenui0DataAttribute {
  readonly name: string
  readonly value: string
}

interface CapabilityAction {
  readonly name: string
  readonly input: string
}

const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i
const bareIdentifierPattern = /^_?[A-Za-z][A-Za-z0-9_]*$/
const signalPathPattern = /^\$_?[A-Za-z][A-Za-z0-9_]*(?:\._?[A-Za-z][A-Za-z0-9_]*)*$/
const numberLiteralPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const stringLiteralPattern = /^(?:"[^"\\<>]*"|'[^'\\<>]*')$/
const primitiveLiteralPattern = /^(?:true|false|null)$/

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

/** Return a data-* attribute only when it belongs to the genui/0 dialect subset. */
export const allowGenui0DataAttribute = ({
  name,
  value,
  grantedCapabilities,
}: Genui0DataAttribute): AllowedGenui0DataAttribute | undefined => {
  const normalized = name.toLowerCase()
  if (value === undefined) return undefined

  if (normalized === "data-on:click" || normalized === "data-on:submit__prevent") {
    const action = parseCapabilityAction(value)
    return action !== undefined &&
      grantedCapabilities.has(action.name) &&
      isSafeObjectExpression(action.input)
      ? { name, value }
      : undefined
  }

  if (normalized === "data-signals") {
    return isSafeObjectExpression(value) ? { name, value } : undefined
  }

  if (normalized === "data-bind") {
    return isSafeBindingExpression(value) ? { name, value } : undefined
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
    return isSafeSimpleExpression(value) ? { name, value } : undefined
  }

  return undefined
}

/** Build the model-facing instruction text for the genui/0 dialect. */
export const genui0Instructions = (capabilities: readonly CapabilityDescriptor[]): string => {
  const capabilityList = capabilities
    .map(
      (capability) =>
        `- ${capability.name}: ${capability.description} effect=${capability.effect} approval=${capability.requiresApproval}`,
    )
    .join("\n")

  return [
    `Generated UI dialect: ${genuiDialect}.`,
    "Create fragment HTML only. Do not include scripts, iframes, external styles, or document tags.",
    "Use @capability('name', input) only for capabilities granted to the surface.",
    "Use only simple v0 expressions: signal reads, primitive literals, and flat object literals.",
    "Available capabilities:",
    capabilityList.length > 0 ? capabilityList : "- none",
  ].join("\n")
}
