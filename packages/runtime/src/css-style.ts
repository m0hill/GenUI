import { splitDelimitedSource } from "./source-scanner.js"

const allowedStylePropertyList = [
  "align-content",
  "align-items",
  "align-self",
  "aspect-ratio",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-collapse",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-spacing",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "border-width",
  "bottom",
  "box-shadow",
  "box-sizing",
  "color",
  "column-gap",
  "cursor",
  "display",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "height",
  "inset",
  "justify-content",
  "justify-items",
  "justify-self",
  "left",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-position",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "object-position",
  "opacity",
  "outline",
  "outline-color",
  "outline-offset",
  "outline-style",
  "outline-width",
  "overflow",
  "overflow-wrap",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "place-content",
  "place-items",
  "pointer-events",
  "position",
  "right",
  "row-gap",
  "text-align",
  "text-decoration",
  "text-transform",
  "top",
  "transform",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "z-index",
]

const propertyPattern = /^(?:--[a-z0-9-]+|[a-z][a-z0-9-]*)$/
const unsafeValuePattern =
  /(?:url|image-set|cross-fade|element|paint|expression)\s*\(|(?:javascript|vbscript|data)\s*:|@import|-moz-binding|behavior\s*:/i
const allowedStyleProperties = new Set(allowedStylePropertyList)

const hasUnsafeStyleCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const code = value.charCodeAt(index)
    if (
      character === "<" ||
      character === ">" ||
      character === "\\" ||
      code === 127 ||
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    ) {
      return true
    }
  }

  return false
}

const splitCssList = (source: string, separator: ":" | ";"): string[] | undefined =>
  splitDelimitedSource(source, {
    separator,
    brackets: { type: "track-depth", open: "(", close: ")" },
  })

const splitDeclaration = (declaration: string): readonly [string, string] | undefined => {
  const parts = splitCssList(declaration, ":")
  if (parts === undefined || parts.length < 2) return undefined

  const property = parts[0]
  const value = parts.slice(1).join(":")
  return property === undefined || value.length === 0 ? undefined : [property, value]
}

export const normalizeStylePropertyName = (property: string): string =>
  property.trim().toLowerCase()

export const normalizeGenuiStylePropertyName = (attributeSuffix: string): string => {
  const property = normalizeStylePropertyName(attributeSuffix)
  return property.startsWith("property-") ? property.slice("property-".length) : property
}

export const isSafeStyleProperty = (property: string): boolean => {
  const normalized = normalizeStylePropertyName(property)
  return propertyPattern.test(normalized) && allowedStyleProperties.has(normalized)
}

export const isSafeStyleValue = (value: string): boolean => {
  const normalized = value.trim()
  return (
    normalized.length > 0 &&
    normalized.length <= 512 &&
    !hasUnsafeStyleCharacter(normalized) &&
    !unsafeValuePattern.test(normalized) &&
    !normalized.includes("/*") &&
    !normalized.includes("*/")
  )
}

export const isSafeStyleDeclaration = (property: string, value: string): boolean =>
  isSafeStyleProperty(property) && isSafeStyleValue(value)

export interface SanitizedInlineStyle {
  readonly value?: string
  readonly dropped: boolean
}

export const sanitizeInlineStyleWithDiagnostics = (source: string): SanitizedInlineStyle => {
  if (source.length > 8_000) return { dropped: true }

  const declarations = splitCssList(source, ";")
  if (declarations === undefined) return { dropped: true }

  let dropped = false
  const safe: string[] = []
  for (const declaration of declarations) {
    if (declaration.length === 0) continue

    const parsed = splitDeclaration(declaration)
    if (parsed === undefined) {
      dropped = true
      continue
    }

    const [property, rawValue] = parsed
    const normalizedProperty = normalizeStylePropertyName(property)
    const value = rawValue.trim()

    if (isSafeStyleDeclaration(normalizedProperty, value)) {
      safe.push(`${normalizedProperty}: ${value};`)
    } else {
      dropped = true
    }
  }

  const value = safe.length === 0 ? undefined : safe.join(" ")
  return value === undefined ? { dropped: true } : { value, dropped }
}

export const sanitizeInlineStyle = (source: string): string | undefined =>
  sanitizeInlineStyleWithDiagnostics(source).value
