import { isDatastarPresenceAttribute } from "./ds/attribute-metadata.js"

/**
 * A primitive value that can be serialized as an HTML attribute value.
 */
export type HtmlPropValue = string | number | boolean | null | undefined

/**
 * A readonly map of HTML attribute names to serializable values.
 */
export type HtmlProps = Readonly<Record<string, HtmlPropValue>>

interface RawHtml {
  readonly _tag: "RawHtml"
  readonly html: string
}

/**
 * A value that can be rendered by Datastar Kit's server-side HTML renderer.
 */
export type HtmlChild =
  | HtmlNode
  | RawHtml
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly HtmlChild[]

/**
 * A lightweight HTML element node used by the JSX runtime and `h()` factory.
 */
export interface HtmlNode {
  /** The HTML tag name to render. */
  readonly tag: string
  /** The attributes rendered on the opening tag. */
  readonly props: HtmlProps
  /** The child nodes rendered inside this element. */
  readonly children: readonly HtmlChild[]
}

/**
 * Error thrown when an HTML tag or attribute name cannot be rendered safely.
 */
export class HtmlNameError extends Error {
  constructor(
    readonly kind: "tag" | "attribute",
    readonly htmlName: string
  ) {
    super(`Invalid HTML ${kind} name: ${JSON.stringify(htmlName)}`)
  }
}

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
])

const isRawHtml = (value: unknown): value is RawHtml =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "RawHtml"

const isHtmlNode = (value: unknown): value is HtmlNode =>
  typeof value === "object" &&
  value !== null &&
  "tag" in value &&
  "props" in value &&
  "children" in value

const escapeHtmlText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const escapeHtmlAttribute = (value: string): string =>
  escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;")

const tagNamePattern = /^[A-Za-z][A-Za-z0-9:-]*$/
const attributeNamePattern = /^[^\s"'<>/=]+$/

const assertTagName = (name: string): void => {
  if (!tagNamePattern.test(name)) {
    throw new HtmlNameError("tag", name)
  }
}

export const assertHtmlAttributeName = (name: string): void => {
  if (!attributeNamePattern.test(name)) {
    throw new HtmlNameError("attribute", name)
  }
}

const booleanAttributes = new Set([
  "allowfullscreen",
  "allowpaymentrequest",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "compact",
  "controls",
  "credentialless",
  "declare",
  "default",
  "defer",
  "disabled",
  "disablepictureinpicture",
  "disableremoteplayback",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nohref",
  "nomodule",
  "noresize",
  "novalidate",
  "nowrap",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "scoped",
  "selected",
  "shadowrootclonable",
  "shadowrootdelegatesfocus",
  "shadowrootserializable",
  "truespeed",
  "typemustmatch",
  "webkitdirectory"
])

const overloadedBooleanAttributes = new Set(["capture", "download"])

const isBooleanAttribute = (name: string): boolean => {
  const normalized = name.toLowerCase()
  return booleanAttributes.has(normalized) || overloadedBooleanAttributes.has(normalized)
}

const isPresenceAttribute = (name: string): boolean =>
  isBooleanAttribute(name) || isDatastarPresenceAttribute(name)

const renderProps = (props: HtmlProps): string => {
  const rendered: Array<string> = []

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) {
      continue
    }

    assertHtmlAttributeName(key)

    if (value === true) {
      rendered.push(isPresenceAttribute(key) ? key : `${key}="true"`)
      continue
    }

    if (value === false) {
      if (!isPresenceAttribute(key)) {
        rendered.push(`${key}="false"`)
      }
      continue
    }

    rendered.push(`${key}="${escapeHtmlAttribute(String(value))}"`)
  }

  return rendered.length === 0 ? "" : ` ${rendered.join(" ")}`
}

/**
 * Creates a lightweight HTML element node without using JSX.
 *
 * @param tag The HTML tag name to render.
 * @param props Attributes rendered on the element.
 * @param children Child nodes rendered inside the element.
 * @returns An HTML node that can be passed to `renderToString()` or response helpers.
 */
export const h = (
  tag: string,
  props: HtmlProps = {},
  ...children: readonly HtmlChild[]
): HtmlNode => {
  assertTagName(tag)
  return {
    tag,
    props,
    children
  }
}

/**
 * Marks a string as trusted HTML so it is inserted without escaping.
 *
 * @remarks
 * This is a trust-boundary escape hatch. Only pass HTML that your application has already
 * sanitized or produced from a trusted source. User input must not be passed to this function.
 *
 * @param html Trusted HTML markup.
 * @returns A renderable HTML child that bypasses text escaping.
 */
export const unsafeHtml = (html: string): HtmlChild => ({
  _tag: "RawHtml",
  html
})

/**
 * Merges multiple HTML prop objects from left to right.
 *
 * @param groups Prop objects to merge.
 * @returns A new prop object containing all supplied properties.
 */
export const mergeProps = (...groups: readonly HtmlProps[]): HtmlProps =>
  Object.assign({}, ...groups)

/**
 * Renders an HTML child tree to a string.
 *
 * @remarks
 * Text and attribute values are escaped by default. Use `unsafeHtml()` only for trusted markup that
 * should cross the escaping boundary deliberately.
 *
 * @param child The child tree to render.
 * @returns Serialized HTML markup.
 */
export const renderToString = (child: HtmlChild): string => {
  if (Array.isArray(child)) {
    return child.map(renderToString).join("")
  }

  if (child === null || child === undefined || typeof child === "boolean") {
    return ""
  }

  if (isRawHtml(child)) {
    return child.html
  }

  if (!isHtmlNode(child)) {
    return escapeHtmlText(String(child))
  }

  assertTagName(child.tag)
  const renderedProps = renderProps(child.props)

  if (voidTags.has(child.tag)) {
    return `<${child.tag}${renderedProps}>`
  }

  return `<${child.tag}${renderedProps}>${child.children.map(renderToString).join("")}</${child.tag}>`
}
