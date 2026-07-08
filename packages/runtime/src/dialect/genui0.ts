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

  if (normalized === "data-genui-on-click" || normalized === "data-genui-on-submit-prevent") {
    const action = parseGenui0CapabilityAction(value)
    return action !== undefined && grantedCapabilities.has(action.capability)
      ? { name, value }
      : undefined
  }

  if (normalized === "data-genui-state") {
    return isSafeGenui0ObjectExpression(value) ? { name, value } : undefined
  }

  if (normalized === "data-genui-bind") {
    return isSafeGenui0BindingExpression(value) ? { name, value } : undefined
  }

  if (
    normalized === "data-genui-show" ||
    normalized === "data-genui-text" ||
    normalized === "data-genui-class" ||
    normalized.startsWith("data-genui-class-") ||
    normalized === "data-genui-style" ||
    normalized.startsWith("data-genui-style-") ||
    normalized.startsWith("data-genui-attr-")
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
    "Use only the GenUI directive namespace: data-genui-state, data-genui-bind, data-genui-on-click, data-genui-on-submit-prevent, data-genui-show, data-genui-text, data-genui-class-name, data-genui-style-property, and data-genui-attr-name.",
    "Use @capability('name', input) only for capabilities granted to the surface.",
    "Use @capability('name', input, { target: 'resultName' }) when multiple calls need separate result state.",
    "Use only simple v0 expressions: state reads like $name or $name.path, primitive literals, comparisons, and flat object literals.",
    "Available capabilities:",
    capabilityList.length > 0 ? capabilityList : "- none",
  ].join("\n")
}
