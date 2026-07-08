import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5"
import { allowGenui0DataAttribute } from "./dialect/genui0.js"

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

const isGenuiBindAttribute = (attribute: Attribute): boolean =>
  attributeName(attribute).toLowerCase() === "data-genui-bind"

const isGenuiEachAttribute = (attribute: Attribute): boolean =>
  attributeName(attribute).toLowerCase() === "data-genui-each"

const sanitizeDataAttribute = (
  attribute: Attribute,
  grantedCapabilities: ReadonlySet<string>,
): Attribute | undefined => {
  const allowed = allowGenui0DataAttribute({
    name: attribute.name,
    value: attribute.value,
    grantedCapabilities,
  })

  return allowed === undefined ? undefined : { name: allowed.name, value: allowed.value }
}

const sanitizeAttribute = (
  attribute: Attribute,
  grantedCapabilities: ReadonlySet<string>,
  insideRepeatedTemplate: boolean,
): Attribute | undefined => {
  const name = attributeName(attribute).toLowerCase()

  if (name.startsWith("on")) return undefined
  if (name === "style") return undefined
  if (insideRepeatedTemplate && name === "data-genui-bind") return undefined
  if (directSubmissionAttributeNames.has(name)) return undefined
  if (name.startsWith("data-")) return sanitizeDataAttribute(attribute, grantedCapabilities)

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
): void => {
  element.attrs = element.attrs.flatMap((attribute) => {
    const safe = sanitizeAttribute(attribute, grantedCapabilities, insideRepeatedTemplate)
    return safe === undefined ? [] : [safe]
  })

  if (element.attrs.some(isGenuiEachAttribute)) {
    element.attrs = element.attrs.filter((attribute) => !isGenuiBindAttribute(attribute))
  }
}

const sanitizeChildren = (
  parent: ParentNode,
  grantedCapabilities: ReadonlySet<string>,
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

    sanitizeAttributes(child, grantedCapabilities, insideRepeatedTemplate)
    sanitizeChildren(
      child,
      grantedCapabilities,
      insideRepeatedTemplate || child.attrs.some(isGenuiEachAttribute),
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
  sanitizeChildren(fragment, grantedCapabilities)
  return serialize(fragment)
}
