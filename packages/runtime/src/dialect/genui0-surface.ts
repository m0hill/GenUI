import type { Action, SanitizationResult } from "@genui/protocol"
import { genui0Dialect } from "./genui0.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"

/** Core-facing genui/0 surface dialect implementation. */
export const genui0SurfaceDialect = {
  id: genui0Dialect.id,
  project: (html: string, grantedActions: readonly Action[]): SanitizationResult =>
    sanitizeSurfaceHtml(html, grantedActions),
  instructions: genui0Dialect.instructions,
} as const
