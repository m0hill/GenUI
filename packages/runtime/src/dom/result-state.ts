import type { ActionResult } from "../types.js"

export type ResultStatus = "pending" | "complete" | "error"

export interface ResultState {
  readonly status: ResultStatus
  readonly value?: unknown
  readonly error?: string
}

const isRecordWithValue = (value: unknown): value is { readonly value: unknown } =>
  typeof value === "object" &&
  value !== null &&
  Object.prototype.hasOwnProperty.call(value, "value")

/** Enter pending while preserving a previous value for stale-while-refresh UIs. */
export const pendingResultState = (previous: unknown): ResultState =>
  isRecordWithValue(previous) ? { status: "pending", value: previous.value } : { status: "pending" }

/** Project an action result envelope into UI-facing request state. */
export const resultStateFromActionResult = (result: ActionResult): ResultState =>
  result.ok
    ? { status: "complete", value: result.value }
    : { status: "error", error: result.error.message }
