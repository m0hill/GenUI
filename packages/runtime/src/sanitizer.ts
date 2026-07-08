import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5"
import { sanitizeInlineStyle } from "./css-style.js"
import {
  allowGenui0DataAttribute,
  genui0AttributeForbiddenInRepeatedTemplate,
  genui0AttributeStartsRepeatedTemplate,
} from "./dialect/genui0.js"

type ParentNode = DefaultTreeAdapterMap["parentNode"]
type ChildNode = DefaultTreeAdapterMap["childNode"]
type ElementNode = DefaultTreeAdapterMap["element"]
type Attribute = ElementNode["attrs"][number]

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
  grantedActions: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
  elementStartsRepeatedTemplate: boolean,
): Attribute | undefined => {
  const allowed = allowGenui0DataAttribute({
    name: attribute.name,
    value: attribute.value,
    grantedActions,
    insideRepeatedTemplate,
    elementStartsRepeatedTemplate,
  })

  return allowed === undefined ? undefined : { name: allowed.name, value: allowed.value }
}

const sanitizeAttribute = (
  attribute: Attribute,
  grantedActions: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
): Attribute | undefined => {
  const name = attributeName(attribute).toLowerCase()

  if (name.startsWith("on")) return undefined
  if (name === "style") {
    const style = sanitizeInlineStyle(attribute.value)
    return style === undefined ? undefined : { ...attribute, value: style }
  }
  if (insideRepeatedTemplate && genui0AttributeForbiddenInRepeatedTemplate(name)) return undefined
  if (directSubmissionAttributeNames.has(name)) return undefined
  if (name.startsWith("data-")) {
    return sanitizeDataAttribute(attribute, grantedActions, insideRepeatedTemplate, false)
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
  grantedActions: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
): void => {
  element.attrs = element.attrs.flatMap((attribute) => {
    const safe = sanitizeAttribute(attribute, grantedActions, insideRepeatedTemplate)
    return safe === undefined ? [] : [safe]
  })

  const startsRepeatedTemplate = element.attrs.some((attribute) =>
    genui0AttributeStartsRepeatedTemplate(attributeName(attribute)),
  )
  if (startsRepeatedTemplate) {
    element.attrs = element.attrs.filter(
      (attribute) => !genui0AttributeForbiddenInRepeatedTemplate(attributeName(attribute)),
    )
  }
}

const sanitizeChildren = (
  parent: ParentNode,
  grantedActions: ReadonlySet<string>,
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

    sanitizeAttributes(child, grantedActions, insideRepeatedTemplate)
    const childStartsRepeatedTemplate = child.attrs.some((attribute) =>
      genui0AttributeStartsRepeatedTemplate(attributeName(attribute)),
    )
    sanitizeChildren(child, grantedActions, insideRepeatedTemplate || childStartsRepeatedTemplate)
    safeChildren.push(child)
  }

  parent.childNodes = safeChildren
}

export const sanitizeSurfaceHtml = (html: string, grantedActions: ReadonlySet<string>): string => {
  const fragment = parseFragment(html)
  sanitizeChildren(fragment, grantedActions)
  return serialize(fragment)
}
