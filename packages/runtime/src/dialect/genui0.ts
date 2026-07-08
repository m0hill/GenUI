import {
  isSafeGenui0BindingExpression,
  isSafeGenui0ObjectExpression,
  isSafeGenui0SimpleExpression,
  parseGenui0CapabilityAction,
} from "./genui0-language.js"
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

/** Return a data-* attribute only when it belongs to the genui/0 dialect subset. */
export const allowGenui0DataAttribute = ({
  name,
  value,
  grantedCapabilities,
}: Genui0DataAttribute): AllowedGenui0DataAttribute | undefined => {
  const normalized = name.toLowerCase()
  if (value === undefined) return undefined

  if (normalized === "data-on:click" || normalized === "data-on:submit__prevent") {
    const action = parseGenui0CapabilityAction(value)
    return action !== undefined && grantedCapabilities.has(action.capability)
      ? { name, value }
      : undefined
  }

  if (normalized === "data-signals") {
    return isSafeGenui0ObjectExpression(value) ? { name, value } : undefined
  }

  if (normalized === "data-bind") {
    return isSafeGenui0BindingExpression(value) ? { name, value } : undefined
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
    return isSafeGenui0SimpleExpression(value) ? { name, value } : undefined
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
    "Use @capability('name', input, { target: 'resultName' }) when multiple calls need separate result state.",
    "Use only simple v0 expressions: signal reads, primitive literals, and flat object literals.",
    "Available capabilities:",
    capabilityList.length > 0 ? capabilityList : "- none",
  ].join("\n")
}
