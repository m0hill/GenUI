import type { CapabilityResult } from "../types.js"
import {
  defaultGenui0ResultTarget,
  normalizeGenui0ResultTarget,
} from "../dialect/genui0-language.js"

export type ResultStatus = "pending" | "complete" | "error"

export interface ResultState {
  readonly status: ResultStatus
  readonly value?: unknown
  readonly error?: string
}

/** Convert a capability name into the default target for result state. */
export const defaultResultTarget = defaultGenui0ResultTarget

/** Keep model-authored result target names inside the v0 state-name subset. */
export const normalizeResultTarget = normalizeGenui0ResultTarget

/** Project a capability result envelope into UI-facing request state. */
export const resultStateFromCapabilityResult = (result: CapabilityResult): ResultState =>
  result.ok
    ? { status: "complete", value: result.value }
    : { status: "error", error: result.error.message }
