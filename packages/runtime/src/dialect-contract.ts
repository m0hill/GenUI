import type { Action, Dialect, SanitizationResult } from "./types.js"

/** Internal surface dialect shape consumed by runtime core. */
export interface CoreDialect {
  readonly id: Dialect
  project(html: string, grantedActions: readonly Action[]): SanitizationResult
  instructions(actions: readonly Action[]): string
}
