import {
  isGenui0StateName,
  isSafeGenui0BindingExpression,
  isSafeGenui0ObjectExpression,
  isSafeGenui0SimpleExpression,
  parseGenui0CapabilityAction,
  parseGenui0SetAction,
} from "./genui0-language.js"
import {
  isSafeStyleProperty,
  isSafeStyleValue,
  normalizeGenuiStylePropertyName,
} from "../css-style.js"
import { genuiDialect, type CapabilityDescriptor } from "../types.js"

export const genui0AttributeNames = {
  state: "data-genui-state",
  bind: "data-genui-bind",
  onClick: "data-genui-on-click",
  onSubmit: "data-genui-on-submit",
  show: "data-genui-show",
  text: "data-genui-text",
  each: "data-genui-each",
  as: "data-genui-as",
  class: "data-genui-class",
  classPrefix: "data-genui-class-",
  style: "data-genui-style",
  stylePrefix: "data-genui-style-",
  attrPrefix: "data-genui-attr-",
} as const

interface Genui0DataAttribute {
  readonly name: string
  readonly value: string | undefined
  readonly grantedCapabilities: ReadonlySet<string>
  readonly insideRepeatedTemplate?: boolean
  readonly elementStartsRepeatedTemplate?: boolean
}

interface AllowedGenui0DataAttribute {
  readonly name: string
  readonly value: string
}

type Genui0AttributePattern =
  | {
      readonly type: "exact"
      readonly name: string
    }
  | {
      readonly type: "prefix"
      readonly prefix: string
    }

type Genui0DirectiveValueKind = "action" | "object" | "binding" | "state_name" | "simple"

interface Genui0DirectiveMatch {
  readonly name: string
  readonly suffix?: string
}

type Genui0RenderableDirective =
  | {
      readonly type: "text"
      readonly expression: string
    }
  | {
      readonly type: "show"
      readonly expression: string
    }
  | {
      readonly type: "class_toggle"
      readonly className: string
      readonly expression: string
    }
  | {
      readonly type: "class_value"
      readonly expression: string
    }
  | {
      readonly type: "style_property"
      readonly property: string
      readonly expression: string
    }
  | {
      readonly type: "style_map"
      readonly expression: string
    }
  | {
      readonly type: "attribute"
      readonly attribute: string
      readonly expression: string
    }

export type Genui0RuntimeDirective = Genui0RenderableDirective & {
  readonly element: Element
  readonly visibleDisplay?: string
  readonly baseClassName?: string
}

interface Genui0ApplyDirectiveContext {
  isTruthy(value: unknown): boolean
  shouldRemoveDynamicValue(value: unknown): boolean
  textValue(value: unknown): string
}

interface Genui0DirectiveDefinition {
  readonly key: string
  readonly pattern: Genui0AttributePattern
  readonly usage: string
  readonly instruction: string
  readonly valueKind: Genui0DirectiveValueKind
  readonly startsRepeatedTemplate?: boolean
  readonly forbiddenInRepeatedTemplate?: boolean
  validateName?(match: Genui0DirectiveMatch): boolean
  renderable?(match: Genui0DirectiveMatch, value: string): Genui0RenderableDirective | undefined
}

const safeDynamicAttribute = (attribute: string): boolean => {
  const name = attribute.toLowerCase()
  if (name.startsWith("aria-")) return true
  return ["role", "title", "disabled", "checked", "value"].includes(name)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const elementStyle = (element: Element): CSSStyleDeclaration | undefined => {
  // SAFETY: generated surfaces render in browser DOMs. Some test DOM implementations do not type
  // their Element as HTMLElement, but still expose the same style API.
  return (element as unknown as { readonly style?: CSSStyleDeclaration }).style
}

const applyAttributeValue = (
  element: Element,
  attribute: string,
  value: unknown,
  context: Genui0ApplyDirectiveContext,
): void => {
  if (!safeDynamicAttribute(attribute)) return

  if (context.shouldRemoveDynamicValue(value)) {
    element.removeAttribute(attribute)
    return
  }

  element.setAttribute(attribute, value === true ? "" : context.textValue(value))
}

const applyStyleValue = (
  element: Element,
  property: string,
  value: unknown,
  context: Genui0ApplyDirectiveContext,
): void => {
  const style = elementStyle(element)
  if (style === undefined || !isSafeStyleProperty(property)) return

  if (context.shouldRemoveDynamicValue(value)) {
    style.removeProperty(property)
    return
  }

  const styleValue = context.textValue(value)
  if (!isSafeStyleValue(styleValue)) {
    style.removeProperty(property)
    return
  }

  style.setProperty(property, styleValue)
}

const genui0DirectiveDefinitions = [
  {
    key: "state",
    pattern: { type: "exact", name: genui0AttributeNames.state },
    usage: genui0AttributeNames.state,
    instruction: "Use data-genui-state for initial local state with a flat object literal.",
    valueKind: "object",
  },
  {
    key: "bind",
    pattern: { type: "exact", name: genui0AttributeNames.bind },
    usage: genui0AttributeNames.bind,
    instruction:
      "Use data-genui-bind for form state outside repeated rows; do not put data-genui-bind inside data-genui-each.",
    valueKind: "binding",
    forbiddenInRepeatedTemplate: true,
  },
  {
    key: "on_click",
    pattern: { type: "exact", name: genui0AttributeNames.onClick },
    usage: genui0AttributeNames.onClick,
    instruction: "Use data-genui-on-click for @capability(...) and @set(...) actions.",
    valueKind: "action",
  },
  {
    key: "on_submit",
    pattern: { type: "exact", name: genui0AttributeNames.onSubmit },
    usage: genui0AttributeNames.onSubmit,
    instruction: "Use data-genui-on-submit on forms; native submission is always prevented.",
    valueKind: "action",
  },
  {
    key: "show",
    pattern: { type: "exact", name: genui0AttributeNames.show },
    usage: genui0AttributeNames.show,
    instruction: "Use data-genui-show to show or hide an authored element from state.",
    valueKind: "simple",
    renderable: (_match, value) => ({ type: "show", expression: value }),
  },
  {
    key: "text",
    pattern: { type: "exact", name: genui0AttributeNames.text },
    usage: genui0AttributeNames.text,
    instruction: "Use data-genui-text to write dynamic text; do not use text interpolation.",
    valueKind: "simple",
    renderable: (_match, value) => ({ type: "text", expression: value }),
  },
  {
    key: "each",
    pattern: { type: "exact", name: genui0AttributeNames.each },
    usage: genui0AttributeNames.each,
    instruction:
      "Render arrays with data-genui-each on a container; its existing children are the item template.",
    valueKind: "simple",
    startsRepeatedTemplate: true,
  },
  {
    key: "as",
    pattern: { type: "exact", name: genui0AttributeNames.as },
    usage: genui0AttributeNames.as,
    instruction: 'Use data-genui-as="order" to read each repeated item as $order.',
    valueKind: "state_name",
  },
  {
    key: "class_value",
    pattern: { type: "exact", name: genui0AttributeNames.class },
    usage: genui0AttributeNames.class,
    instruction: "Use data-genui-class for a full dynamic class string from state.",
    valueKind: "simple",
    renderable: (_match, value) => ({ type: "class_value", expression: value }),
  },
  {
    key: "class_toggle",
    pattern: { type: "prefix", prefix: genui0AttributeNames.classPrefix },
    usage: "data-genui-class-{class-name}",
    instruction: "Use data-genui-class-{class-name} to toggle one kebab-case class from state.",
    valueKind: "simple",
    renderable: (match, value) =>
      match.suffix === undefined
        ? undefined
        : { type: "class_toggle", className: match.suffix, expression: value },
  },
  {
    key: "style_map",
    pattern: { type: "exact", name: genui0AttributeNames.style },
    usage: genui0AttributeNames.style,
    instruction: "Use data-genui-style with an object expression for multiple safe style values.",
    valueKind: "simple",
    renderable: (_match, value) => ({ type: "style_map", expression: value }),
  },
  {
    key: "style_property",
    pattern: { type: "prefix", prefix: genui0AttributeNames.stylePrefix },
    usage: "data-genui-style-{css-property}",
    instruction:
      "Use data-genui-style-{css-property} only when one safe style value must come from state, e.g. data-genui-style-background-color.",
    valueKind: "simple",
    validateName: (match) =>
      match.suffix !== undefined &&
      isSafeStyleProperty(normalizeGenuiStylePropertyName(match.suffix)),
    renderable: (match, value) =>
      match.suffix === undefined
        ? undefined
        : {
            type: "style_property",
            property: normalizeGenuiStylePropertyName(match.suffix),
            expression: value,
          },
  },
  {
    key: "attribute",
    pattern: { type: "prefix", prefix: genui0AttributeNames.attrPrefix },
    usage: "data-genui-attr-{attribute}",
    instruction:
      "Use data-genui-attr-{attribute} only for safe dynamic attributes: aria-*, role, title, disabled, checked, and value.",
    valueKind: "simple",
    validateName: (match) => match.suffix !== undefined && safeDynamicAttribute(match.suffix),
    renderable: (match, value) =>
      match.suffix === undefined
        ? undefined
        : { type: "attribute", attribute: match.suffix, expression: value },
  },
] as const satisfies readonly Genui0DirectiveDefinition[]

export const genui0DirectiveInstructionLines = genui0DirectiveDefinitions.map(
  (definition) => definition.instruction,
)

export const genui0DirectiveUsages = genui0DirectiveDefinitions.map(
  (definition) => definition.usage,
)

const matchesPattern = (
  pattern: Genui0AttributePattern,
  normalizedName: string,
): Genui0DirectiveMatch | undefined => {
  if (pattern.type === "exact") {
    return normalizedName === pattern.name ? { name: normalizedName } : undefined
  }

  if (!normalizedName.startsWith(pattern.prefix)) return undefined

  const suffix = normalizedName.slice(pattern.prefix.length)
  return suffix.length === 0 ? undefined : { name: normalizedName, suffix }
}

const findDirective = (
  name: string,
):
  | { readonly definition: Genui0DirectiveDefinition; readonly match: Genui0DirectiveMatch }
  | undefined => {
  const normalized = name.toLowerCase()
  for (const definition of genui0DirectiveDefinitions) {
    const match = matchesPattern(definition.pattern, normalized)
    if (match !== undefined) return { definition, match }
  }
  return undefined
}

const isAllowedActionExpression = (
  value: string,
  grantedCapabilities: ReadonlySet<string>,
): boolean => {
  if (parseGenui0SetAction(value) !== undefined) return true

  const action = parseGenui0CapabilityAction(value)
  return action !== undefined && grantedCapabilities.has(action.capability)
}

const isAllowedValue = (
  valueKind: Genui0DirectiveValueKind,
  value: string,
  grantedCapabilities: ReadonlySet<string>,
): boolean => {
  if (valueKind === "action") return isAllowedActionExpression(value, grantedCapabilities)
  if (valueKind === "object") return isSafeGenui0ObjectExpression(value)
  if (valueKind === "binding") return isSafeGenui0BindingExpression(value)
  if (valueKind === "state_name") return isGenui0StateName(value)
  return isSafeGenui0SimpleExpression(value)
}

/** Return a data-* attribute only when it belongs to the genui/0 dialect subset. */
export const allowGenui0DataAttribute = ({
  name,
  value,
  grantedCapabilities,
  insideRepeatedTemplate = false,
  elementStartsRepeatedTemplate = false,
}: Genui0DataAttribute): AllowedGenui0DataAttribute | undefined => {
  if (value === undefined) return undefined

  const directive = findDirective(name)
  if (directive === undefined) return undefined

  if (
    directive.definition.forbiddenInRepeatedTemplate === true &&
    (insideRepeatedTemplate || elementStartsRepeatedTemplate)
  ) {
    return undefined
  }
  if (directive.definition.validateName?.(directive.match) === false) return undefined
  if (!isAllowedValue(directive.definition.valueKind, value, grantedCapabilities)) return undefined

  return { name, value }
}

export const genui0AttributeStartsRepeatedTemplate = (name: string): boolean =>
  findDirective(name)?.definition.startsRepeatedTemplate === true

export const genui0AttributeForbiddenInRepeatedTemplate = (name: string): boolean =>
  findDirective(name)?.definition.forbiddenInRepeatedTemplate === true

export const genui0RenderableDirectiveFromAttribute = ({
  name,
  value,
}: {
  readonly name: string
  readonly value: string
}): Genui0RenderableDirective | undefined => {
  const directive = findDirective(name)
  if (directive === undefined) return undefined
  if (directive.definition.validateName?.(directive.match) === false) return undefined

  return directive.definition.renderable?.(directive.match, value)
}

export const genui0RuntimeDirectiveFromAttribute = ({
  element,
  attribute,
}: {
  readonly element: Element
  readonly attribute: Attr
}): Genui0RuntimeDirective | undefined => {
  const directive = genui0RenderableDirectiveFromAttribute(attribute)
  if (directive === undefined) return undefined

  return {
    ...directive,
    element,
    visibleDisplay: directive.type === "show" ? (elementStyle(element)?.display ?? "") : undefined,
    baseClassName: directive.type === "class_value" ? element.className : undefined,
  }
}

export const applyGenui0RuntimeDirective = (
  directive: Genui0RuntimeDirective,
  value: unknown,
  context: Genui0ApplyDirectiveContext,
): void => {
  if (directive.type === "text") {
    directive.element.textContent = context.textValue(value)
    return
  }

  if (directive.type === "show") {
    const style = elementStyle(directive.element)
    if (style !== undefined) {
      style.display = context.isTruthy(value) ? (directive.visibleDisplay ?? "") : "none"
    }
    return
  }

  if (directive.type === "class_toggle") {
    directive.element.classList.toggle(directive.className, context.isTruthy(value))
    return
  }

  if (directive.type === "class_value") {
    const dynamicClass = typeof value === "string" ? value.trim() : ""
    directive.element.className =
      dynamicClass.length === 0
        ? (directive.baseClassName ?? "")
        : [directive.baseClassName ?? "", dynamicClass].filter((item) => item.length > 0).join(" ")
    return
  }

  if (directive.type === "style_property") {
    applyStyleValue(directive.element, directive.property, value, context)
    return
  }

  if (directive.type === "style_map") {
    if (isRecord(value)) {
      for (const [property, propertyValue] of Object.entries(value)) {
        applyStyleValue(directive.element, property, propertyValue, context)
      }
    }
    return
  }

  applyAttributeValue(directive.element, directive.attribute, value, context)
}

export const genui0HtmlDialectPolicy = {
  allowDataAttribute: allowGenui0DataAttribute,
  startsRepeatedTemplate: genui0AttributeStartsRepeatedTemplate,
  forbiddenInRepeatedTemplate: genui0AttributeForbiddenInRepeatedTemplate,
} as const

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
    "Use inline style attributes for static presentation.",
    `Use only the GenUI directive namespace: ${genui0DirectiveUsages.join(", ")}.`,
    ...genui0DirectiveInstructionLines,
    "Use @capability('name', input) only for capabilities granted to the surface.",
    "Use @capability('name', input, { target: 'resultName' }) when multiple calls need separate result state.",
    "Use @set('state.path', value) for local-only interactions such as tabs, toggles, disclosure, and selection.",
    "Capability result state is written to $target.status, $target.value, and $target.error; status is 'pending', 'complete', or 'error'.",
    "When a target with a previous value becomes pending, $target.value remains available so existing lists and details can stay visible.",
    "When target is omitted, the default result target is the camel-cased capability name, e.g. orders.search writes to $ordersSearch.",
    "Nested data-genui-each blocks can read outer and inner scope together, e.g. $order.id and $line.id.",
    "Use array length reads such as $orders.value.items.length for empty states.",
    "Use only simple v0 expressions: state reads like $name or $name.path, primitive literals, comparisons, and flat object literals.",
    "Available capabilities:",
    capabilityList.length > 0 ? capabilityList : "- none",
  ].join("\n")
}
