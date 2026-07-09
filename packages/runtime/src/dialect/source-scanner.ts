type BracketPolicy =
  | { readonly type: "reject"; readonly characters: string }
  | { readonly type: "track-depth"; readonly open: string; readonly close: string }

interface SplitDelimitedSourceOptions {
  readonly separator: string
  readonly brackets: BracketPolicy
  readonly requireNonEmptyParts?: boolean
}

const isQuote = (character: string): character is '"' | "'" =>
  character === '"' || character === "'"

const nextDepth = (depth: number, character: string, policy: BracketPolicy): number | undefined => {
  if (policy.type === "reject") return policy.characters.includes(character) ? undefined : depth
  if (policy.open.includes(character)) return depth + 1
  if (!policy.close.includes(character)) return depth

  const next = depth - 1
  return next < 0 ? undefined : next
}

/** Split source at separators outside quotes and configured bracket depth. */
export const splitDelimitedSource = (
  source: string,
  options: SplitDelimitedSourceOptions,
): string[] | undefined => {
  const parts: string[] = []
  let quote: '"' | "'" | undefined
  let depth = 0
  let start = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === undefined) return undefined
    if (character === "\\") return undefined

    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }

    if (isQuote(character)) {
      quote = character
      continue
    }

    const updatedDepth = nextDepth(depth, character, options.brackets)
    if (updatedDepth === undefined) return undefined
    depth = updatedDepth

    if (character === options.separator && depth === 0) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }

  if (quote !== undefined || depth !== 0) return undefined

  parts.push(source.slice(start).trim())
  return options.requireNonEmptyParts === true && parts.some((part) => part.length === 0)
    ? undefined
    : parts
}
