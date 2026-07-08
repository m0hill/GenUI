import type { CapabilityResult } from "../types.js"

export type ResultStatus = "pending" | "complete" | "error"

export interface ResultState {
  readonly status: ResultStatus
  readonly value?: unknown
  readonly error?: string
}

const resultTargetPattern = /^_?[A-Za-z][A-Za-z0-9_]*$/

const camelCaseWords = (words: readonly string[]): string => {
  const [first, ...rest] = words
  if (first === undefined) return "capability"

  return [
    first.toLowerCase(),
    ...rest.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`),
  ].join("")
}

/** Convert a capability name into the default signal target for result state. */
export const defaultResultTarget = (capability: string): string => {
  const words = capability.split(/[._-]+/).filter((part) => part.length > 0)
  const target = camelCaseWords(words)
  return resultTargetPattern.test(target) ? target : "capability"
}

/** Keep model-authored result target names inside the v0 signal-name subset. */
export const normalizeResultTarget = (target: string | undefined, capability: string): string =>
  target !== undefined && resultTargetPattern.test(target)
    ? target
    : defaultResultTarget(capability)

/** Project a capability result envelope into UI-facing request state. */
export const resultStateFromCapabilityResult = (result: CapabilityResult): ResultState =>
  result.ok
    ? { status: "complete", value: result.value }
    : { status: "error", error: result.error.message }
