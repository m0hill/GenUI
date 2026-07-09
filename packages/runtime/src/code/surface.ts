import type { Action, SanitizationResult } from "../types.js"
import { codeDialect } from "../types.js"
import { codeInstructions } from "./instructions.js"

/** Core-facing code/0 surface dialect with isolation delegated to the iframe boundary. */
export const codeSurfaceDialect = {
  id: codeDialect,
  project: (content: string, _grantedActions: readonly Action[]): SanitizationResult => ({
    html: content,
    dropped: [],
  }),
  instructions: codeInstructions,
} as const
