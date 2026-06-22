import { renderToString, type HtmlChild } from "./html.js"
import { navigationScript, type NavigationSafetyOptions } from "./navigation.js"
import {
  comment as sseComment,
  executeScript,
  patchElements,
  patchSignals,
  type ExecuteScriptOptions,
  type PatchElementsOptions,
  type PatchSignalsOptions,
  type SignalState
} from "./sse.js"

export { NavigationUrlError } from "./navigation.js"

/** Encodes an SSE comment chunk for manual stream heartbeats or diagnostics. */
export const comment = (text = ""): string => sseComment(text)

/** Options for a safe navigation event chunk. */
export type NavigateOptions = ExecuteScriptOptions & NavigationSafetyOptions

/** Renders HTML and encodes it as one Datastar patch-elements SSE event chunk. */
export const patch = (elements: HtmlChild, options?: PatchElementsOptions): string =>
  patchElements(renderToString(elements), options)

/** Encodes signal state as one Datastar patch-signals SSE event chunk. */
export const signals = (value: SignalState, options?: PatchSignalsOptions): string =>
  patchSignals(value, options)

/**
 * Encodes trusted JavaScript as one Datastar script execution SSE event chunk.
 * Prefer structured element or signal patches when possible.
 */
export const script = (code: string, options?: ExecuteScriptOptions): string =>
  executeScript(code, options)

/**
 * Encodes a safe browser navigation as one Datastar SSE event chunk.
 */
export const navigate = (url: string | URL, options: NavigateOptions = {}): string => {
  const { baseUrl, allowedOrigins, ...scriptOptions } = options
  return executeScript(
    navigationScript(url, {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(allowedOrigins === undefined ? {} : { allowedOrigins })
    }),
    scriptOptions
  )
}
