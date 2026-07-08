import type { CapabilityResult } from "../types.js"
import { genui0Language } from "../dialect/genui0-language.js"

export type ResultStatus = "pending" | "complete" | "error"

export interface ResultState {
  readonly status: ResultStatus
  readonly value?: unknown
  readonly error?: string
}

/** Convert a capability name into the default target for result state. */
export const defaultResultTarget = (capability: string): string =>
  genui0Language.defaultResultTarget(capability)

/** Keep model-authored result target names inside the v0 state-name subset. */
export const normalizeResultTarget = (target: string | undefined, capability: string): string =>
  genui0Language.normalizeResultTarget(target, capability)

/** Project a capability result envelope into UI-facing request state. */
export const resultStateFromCapabilityResult = (result: CapabilityResult): ResultState =>
  result.ok
    ? { status: "complete", value: result.value }
    : { status: "error", error: result.error.message }
