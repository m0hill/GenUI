import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5"
import { sanitizeInlineStyle } from "./css-style.js"
import { genui0HtmlDialectPolicy } from "./dialect/genui0.js"

type ParentNode = DefaultTreeAdapterMap["parentNode"]
type ChildNode = DefaultTreeAdapterMap["childNode"]
type ElementNode = DefaultTreeAdapterMap["element"]
type Attribute = ElementNode["attrs"][number]

interface SanitizerDialectPolicy {
  allowDataAttribute(input: {
    readonly name: string
    readonly value: string | undefined
    readonly grantedCapabilities: ReadonlySet<string>
    readonly insideRepeatedTemplate: boolean
    readonly elementStartsRepeatedTemplate: boolean
  }): { readonly name: string; readonly value: string } | undefined
  startsRepeatedTemplate(attributeName: string): boolean
  forbiddenInRepeatedTemplate(attributeName: string): boolean
}

const removedElementTags = new Set([
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "style",
  "template",
])

const directSubmissionAttributeNames = new Set([
  "action",
  "download",
  "enctype",
  "formaction",
  "formnovalidate",
  "method",
  "ping",
  "srcdoc",
  "target",
])

const allowedUrlAttributeNames = new Set(["href", "src"])

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

const sanitizeDataAttribute = (
  attribute: Attribute,
  grantedCapabilities: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
  elementStartsRepeatedTemplate: boolean,
  dialect: SanitizerDialectPolicy,
): Attribute | undefined => {
  const allowed = dialect.allowDataAttribute({
    name: attribute.name,
    value: attribute.value,
    grantedCapabilities,
    insideRepeatedTemplate,
    elementStartsRepeatedTemplate,
  })

  return allowed === undefined ? undefined : { name: allowed.name, value: allowed.value }
}

const sanitizeAttribute = (
  attribute: Attribute,
  grantedCapabilities: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
  dialect: SanitizerDialectPolicy,
): Attribute | undefined => {
  const name = attributeName(attribute).toLowerCase()

  if (name.startsWith("on")) return undefined
  if (name === "style") {
    const style = sanitizeInlineStyle(attribute.value)
    return style === undefined ? undefined : { ...attribute, value: style }
  }
  if (insideRepeatedTemplate && dialect.forbiddenInRepeatedTemplate(name)) return undefined
  if (directSubmissionAttributeNames.has(name)) return undefined
  if (name.startsWith("data-")) {
    return sanitizeDataAttribute(
      attribute,
      grantedCapabilities,
      insideRepeatedTemplate,
      false,
      dialect,
    )
  }

  if (allowedUrlAttributeNames.has(name)) {
    return isSafeHttpsUrl(attribute.value)
      ? { ...attribute, value: attribute.value.trim() }
      : undefined
  }

  if (removedUrlAttributeNames.has(name) || name.endsWith(":href")) return undefined

  return attribute
}

const sanitizeAttributes = (
  element: ElementNode,
  grantedCapabilities: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
  dialect: SanitizerDialectPolicy,
): void => {
  element.attrs = element.attrs.flatMap((attribute) => {
    const safe = sanitizeAttribute(attribute, grantedCapabilities, insideRepeatedTemplate, dialect)
    return safe === undefined ? [] : [safe]
  })

  const startsRepeatedTemplate = element.attrs.some((attribute) =>
    dialect.startsRepeatedTemplate(attributeName(attribute)),
  )
  if (startsRepeatedTemplate) {
    element.attrs = element.attrs.filter(
      (attribute) => !dialect.forbiddenInRepeatedTemplate(attributeName(attribute)),
    )
  }
}

const sanitizeChildren = (
  parent: ParentNode,
  grantedCapabilities: ReadonlySet<string>,
  dialect: SanitizerDialectPolicy,
  insideRepeatedTemplate = false,
): void => {
  const safeChildren: ChildNode[] = []

  for (const child of parent.childNodes) {
    if (child.nodeName === "#comment" || child.nodeName === "#documentType") continue
    if (!isElementNode(child)) {
      safeChildren.push(child)
      continue
    }

    if (removedElementTags.has(child.tagName.toLowerCase())) continue

    sanitizeAttributes(child, grantedCapabilities, insideRepeatedTemplate, dialect)
    const childStartsRepeatedTemplate = child.attrs.some((attribute) =>
      dialect.startsRepeatedTemplate(attributeName(attribute)),
    )
    sanitizeChildren(
      child,
      grantedCapabilities,
      dialect,
      insideRepeatedTemplate || childStartsRepeatedTemplate,
    )
    safeChildren.push(child)
  }

  parent.childNodes = safeChildren
}

export const sanitizeSurfaceHtml = (
  html: string,
  grantedCapabilities: ReadonlySet<string>,
): string => {
  const fragment = parseFragment(html)
  sanitizeChildren(fragment, grantedCapabilities, genui0HtmlDialectPolicy)
  return serialize(fragment)
}
