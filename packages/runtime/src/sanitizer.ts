import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5"
import { sanitizeInlineStyleWithDiagnostics } from "./css-style.js"
import {
  allowGenui0DataAttribute,
  genui0AttributeForbiddenInRepeatedTemplate,
  genui0AttributeStartsRepeatedTemplate,
} from "./dialect/genui0.js"
import type {
  Action,
  SanitizationDrop,
  SanitizationDropReason,
  SanitizationResult,
} from "./types.js"

type ParentNode = DefaultTreeAdapterMap["parentNode"]
type ChildNode = DefaultTreeAdapterMap["childNode"]
type ElementNode = DefaultTreeAdapterMap["element"]
type Attribute = ElementNode["attrs"][number]

interface SanitizationContext {
  readonly grantedActions: ReadonlyMap<string, Action>
  readonly dropped: SanitizationDrop[]
}

type SanitizedAttribute =
  | {
      readonly keep: true
      readonly attribute: Attribute
      readonly reason?: SanitizationDropReason
      readonly value?: string
    }
  | {
      readonly keep: false
      readonly reason: SanitizationDropReason
      readonly value?: string
    }

const allowedElementTags = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "mark",
  "meter",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "pre",
  "progress",
  "s",
  "samp",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
])

const globalAttributeNames = new Set([
  "class",
  "dir",
  "hidden",
  "id",
  "inert",
  "lang",
  "role",
  "tabindex",
  "title",
])

const tagSpecificAttributeNames = new Map<string, ReadonlySet<string>>([
  ["a", new Set(["rel"])],
  ["button", new Set(["autofocus", "disabled", "name", "type", "value"])],
  ["col", new Set(["span"])],
  ["colgroup", new Set(["span"])],
  ["details", new Set(["open"])],
  ["fieldset", new Set(["disabled", "name"])],
  ["img", new Set(["alt", "decoding", "height", "loading", "width"])],
  [
    "input",
    new Set([
      "accept",
      "autocomplete",
      "autofocus",
      "checked",
      "disabled",
      "inputmode",
      "list",
      "max",
      "maxlength",
      "min",
      "minlength",
      "multiple",
      "name",
      "pattern",
      "placeholder",
      "readonly",
      "required",
      "size",
      "step",
      "type",
      "value",
    ]),
  ],
  ["label", new Set(["for"])],
  ["li", new Set(["value"])],
  ["meter", new Set(["high", "low", "max", "min", "optimum", "value"])],
  ["ol", new Set(["reversed", "start", "type"])],
  ["optgroup", new Set(["disabled", "label"])],
  ["option", new Set(["disabled", "label", "selected", "value"])],
  ["progress", new Set(["max", "value"])],
  ["select", new Set(["autofocus", "disabled", "multiple", "name", "required", "size"])],
  ["td", new Set(["colspan", "headers", "rowspan"])],
  [
    "textarea",
    new Set([
      "autocomplete",
      "autofocus",
      "cols",
      "disabled",
      "maxlength",
      "minlength",
      "name",
      "placeholder",
      "readonly",
      "required",
      "rows",
      "spellcheck",
    ]),
  ],
  ["th", new Set(["colspan", "headers", "rowspan", "scope"])],
  ["time", new Set(["datetime"])],
])

const directSubmissionAttributeNames = new Set([
  "action",
  "download",
  "enctype",
  "form",
  "formaction",
  "formenctype",
  "formmethod",
  "formnovalidate",
  "formtarget",
  "method",
  "ping",
  "srcdoc",
  "target",
])

const allowedUrlAttributeNamesByTag = new Map<string, ReadonlySet<string>>([
  ["a", new Set(["href"])],
  ["img", new Set(["src"])],
])

const removedUrlAttributeNames = new Set([
  "archive",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "longdesc",
  "manifest",
  "poster",
  "profile",
  "srcset",
  "usemap",
  "xlink:href",
])

const attributeName = (attribute: Attribute): string =>
  attribute.prefix === undefined ? attribute.name : `${attribute.prefix}:${attribute.name}`

const isElementNode = (node: ChildNode): node is ElementNode => "tagName" in node

const isSafeHttpsUrl = (value: string): boolean => /^https:\/\//i.test(value.trim())

const isAllowedStaticAttribute = (tagName: string, name: string): boolean =>
  name.startsWith("aria-") ||
  globalAttributeNames.has(name) ||
  (tagSpecificAttributeNames.get(tagName)?.has(name) ?? false)

const isAllowedUrlAttribute = (tagName: string, name: string): boolean =>
  allowedUrlAttributeNamesByTag.get(tagName)?.has(name) ?? false

const sanitizationDropValue = (value: string): string =>
  value.length <= 200 ? value : `${value.slice(0, 197)}...`

const recordDrop = (
  dropped: SanitizationDrop[],
  node: string,
  reason: SanitizationDropReason,
  attribute?: string,
  value?: string,
): void => {
  const safeValue = value === undefined ? undefined : sanitizationDropValue(value)
  dropped.push(
    Object.freeze({
      node,
      reason,
      ...(attribute === undefined ? {} : { attribute }),
      ...(safeValue === undefined ? {} : { value: safeValue }),
    }),
  )
}

const keepAttribute = (
  attribute: Attribute,
  reason?: SanitizationDropReason,
  value?: string,
): SanitizedAttribute =>
  reason === undefined
    ? { keep: true, attribute }
    : { keep: true, attribute, reason, ...(value === undefined ? {} : { value }) }

const dropAttribute = (reason: SanitizationDropReason, value?: string): SanitizedAttribute => ({
  keep: false,
  reason,
  ...(value === undefined ? {} : { value }),
})

const sanitizeDataAttribute = (
  attribute: Attribute,
  grantedActions: ReadonlyMap<string, Action>,
  insideRepeatedTemplate: boolean,
  insideKeyedRepeatedTemplate: boolean,
  elementStartsRepeatedTemplate: boolean,
): SanitizedAttribute => {
  const result = allowGenui0DataAttribute({
    name: attribute.name,
    value: attribute.value,
    grantedActions,
    insideRepeatedTemplate,
    insideKeyedRepeatedTemplate,
    elementStartsRepeatedTemplate,
  })

  return "reason" in result
    ? dropAttribute(result.reason, attribute.value)
    : keepAttribute({ name: result.name, value: result.value })
}

const sanitizeAttribute = (
  tagName: string,
  attribute: Attribute,
  grantedActions: ReadonlyMap<string, Action>,
  insideRepeatedTemplate: boolean,
  insideKeyedRepeatedTemplate: boolean,
  elementStartsRepeatedTemplate: boolean,
): SanitizedAttribute => {
  const name = attributeName(attribute).toLowerCase()

  if (name.startsWith("on")) return dropAttribute("event_handler", attribute.value)
  if (name === "style") {
    const style = sanitizeInlineStyleWithDiagnostics(attribute.value)
    if (style.value === undefined) return dropAttribute("unsafe_style", attribute.value)
    return keepAttribute(
      { ...attribute, value: style.value },
      style.dropped ? "unsafe_style_declaration" : undefined,
      style.dropped ? attribute.value : undefined,
    )
  }
  if (insideRepeatedTemplate && genui0AttributeForbiddenInRepeatedTemplate(name)) {
    return dropAttribute("forbidden_repeated_template_attribute", attribute.value)
  }
  if (directSubmissionAttributeNames.has(name)) {
    return dropAttribute("form_submission_attribute", attribute.value)
  }
  if (name.startsWith("data-")) {
    return sanitizeDataAttribute(
      attribute,
      grantedActions,
      insideRepeatedTemplate,
      insideKeyedRepeatedTemplate,
      elementStartsRepeatedTemplate,
    )
  }

  if (removedUrlAttributeNames.has(name) || name.endsWith(":href")) {
    return dropAttribute("url_attribute", attribute.value)
  }

  if (isAllowedUrlAttribute(tagName, name)) {
    return isSafeHttpsUrl(attribute.value)
      ? keepAttribute({ ...attribute, value: attribute.value.trim() })
      : dropAttribute("unsafe_url", attribute.value)
  }

  if (isAllowedStaticAttribute(tagName, name)) {
    return keepAttribute(attribute)
  }

  return dropAttribute("unsupported_attribute", attribute.value)
}

const sanitizeAttributes = (
  element: ElementNode,
  context: SanitizationContext,
  insideRepeatedTemplate: boolean,
  insideKeyedRepeatedTemplate: boolean,
): void => {
  const elementStartsRepeatedTemplate = element.attrs.some((attribute) =>
    genui0AttributeStartsRepeatedTemplate(attributeName(attribute)),
  )

  element.attrs = element.attrs.flatMap((attribute) => {
    const safe = sanitizeAttribute(
      element.tagName.toLowerCase(),
      attribute,
      context.grantedActions,
      insideRepeatedTemplate,
      insideKeyedRepeatedTemplate,
      elementStartsRepeatedTemplate,
    )
    if (!safe.keep) {
      recordDrop(
        context.dropped,
        element.tagName,
        safe.reason,
        attributeName(attribute),
        safe.value,
      )
      return []
    }

    if (safe.reason !== undefined) {
      recordDrop(
        context.dropped,
        element.tagName,
        safe.reason,
        attributeName(attribute),
        safe.value,
      )
    }
    return [safe.attribute]
  })

  const startsRepeatedTemplate = element.attrs.some((attribute) =>
    genui0AttributeStartsRepeatedTemplate(attributeName(attribute)),
  )
  if (startsRepeatedTemplate) {
    element.attrs = element.attrs.filter((attribute) => {
      const forbidden = genui0AttributeForbiddenInRepeatedTemplate(attributeName(attribute))
      if (forbidden) {
        recordDrop(
          context.dropped,
          element.tagName,
          "forbidden_repeated_template_attribute",
          attributeName(attribute),
          attribute.value,
        )
      }
      return !forbidden
    })
  }
}

const sanitizeChildren = (
  parent: ParentNode,
  context: SanitizationContext,
  insideRepeatedTemplate = false,
  insideKeyedRepeatedTemplate = false,
): void => {
  const safeChildren: ChildNode[] = []

  for (const child of parent.childNodes) {
    if (child.nodeName === "#comment" || child.nodeName === "#documentType") {
      recordDrop(context.dropped, child.nodeName, "unsupported_node")
      continue
    }
    if (!isElementNode(child)) {
      safeChildren.push(child)
      continue
    }

    if (!allowedElementTags.has(child.tagName.toLowerCase())) {
      recordDrop(context.dropped, child.tagName, "forbidden_element")
      continue
    }

    sanitizeAttributes(child, context, insideRepeatedTemplate, insideKeyedRepeatedTemplate)
    const childStartsRepeatedTemplate = child.attrs.some((attribute) =>
      genui0AttributeStartsRepeatedTemplate(attributeName(attribute)),
    )
    const childStartsKeyedRepeatedTemplate =
      childStartsRepeatedTemplate &&
      child.attrs.some((attribute) => attributeName(attribute) === "data-genui-key")
    sanitizeChildren(
      child,
      context,
      insideRepeatedTemplate || childStartsRepeatedTemplate,
      childStartsRepeatedTemplate ? childStartsKeyedRepeatedTemplate : insideKeyedRepeatedTemplate,
    )
    safeChildren.push(child)
  }

  parent.childNodes = safeChildren
}

export const sanitizeSurfaceHtml = (
  html: string,
  grantedActions: readonly Action[],
): SanitizationResult => {
  const fragment = parseFragment(html)
  const context: SanitizationContext = {
    grantedActions: new Map(grantedActions.map((action) => [action.name, action])),
    dropped: [],
  }
  sanitizeChildren(fragment, context)
  return Object.freeze({
    html: serialize(fragment),
    dropped: Object.freeze(context.dropped),
  })
}
