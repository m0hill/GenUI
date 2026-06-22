import { assertHtmlAttributeName } from "../html.js"

/**
 * Builds a space-separated attribute-name list for Datastar's `data-preserve-attr` attribute.
 *
 * @example
 * ```tsx
 * <details open data-preserve-attr={preserve("open", "class")} />
 * ```
 */
export const preserve = (first: string, ...rest: readonly string[]): string => {
  const names = [first, ...rest]

  for (const name of names) {
    assertHtmlAttributeName(name)
  }

  return names.join(" ")
}
