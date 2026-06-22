import { raw, toJs, type DatastarFunction, type Expr, type ExprInput } from "./expression.js"
import type { SignalStateInput } from "./signals.js"

/**
 * Datastar signal filter used by signal display, signal patch, and fetch action helpers.
 */
export interface SignalFilter {
  /** Regular expression or expression selecting signal paths to include. */
  readonly include?: Expr<RegExp> | RegExp | string
  /** Regular expression or expression selecting signal paths to exclude. */
  readonly exclude?: Expr<RegExp> | RegExp | string
}

/**
 * Options accepted by Datastar fetch actions such as `@get()` and `@post()`.
 *
 * @see https://data-star.dev/reference/actions#get
 */
export interface FetchActionOptions {
  /** CSS selector for a form when `contentType` is `"form"`; `null` uses the closest form. */
  readonly selector?: string | null
  /** Headers sent with the fetch request. */
  readonly headers?: Readonly<Record<string, string>>
  /** Request encoding used by Datastar. @defaultValue `"json"` */
  readonly contentType?: "json" | "form"
  /** Signals included in JSON requests. */
  readonly filterSignals?: SignalFilter
  /** Whether `GET` streams stay open while the page is hidden. */
  readonly openWhenHidden?: boolean
  /** Explicit JSON signal payload sent instead of Datastar's filtered signal state. */
  readonly payload?: SignalStateInput
  /** Retry policy for failed requests. @defaultValue `"auto"` */
  readonly retry?: "auto" | "error" | "always" | "never"
  /** Initial retry interval in milliseconds. @defaultValue `1000` */
  readonly retryInterval?: number
  /** Multiplier applied to retry wait times. @defaultValue `2` */
  readonly retryScaler?: number
  /** Maximum wait between retries. @defaultValue `30000` */
  readonly retryMaxWait?: number
  /** Maximum retry attempt count. @defaultValue `10` */
  readonly retryMaxCount?: number
  /** Request cancellation behavior or a custom abort controller expression. @defaultValue `"auto"` */
  readonly requestCancellation?: "auto" | "cleanup" | "disabled" | Expr<AbortController>
}

const fetchOptionKeys = [
  "selector",
  "headers",
  "contentType",
  "filterSignals",
  "openWhenHidden",
  "payload",
  "retry",
  "retryInterval",
  "retryScaler",
  "retryMaxWait",
  "retryMaxCount",
  "requestCancellation"
] as const satisfies readonly (keyof FetchActionOptions)[]

const fetchOptionsToJs = (options: FetchActionOptions): string => {
  const entries: string[] = []

  for (const key of fetchOptionKeys) {
    const value = options[key]
    if (value !== undefined) entries.push(`${key}: ${toJs(value)}`)
  }

  return `{${entries.join(", ")}}`
}

const escapeTemplateText = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")

const urlToJs = (url: ExprInput<string>): string =>
  typeof url === "string" ? JSON.stringify(url) : url.toDatastarExpression()

const splitHash = (path: string): { readonly beforeHash: string; readonly hash: string } => {
  const hashIndex = path.indexOf("#")
  if (hashIndex === -1) {
    return { beforeHash: path, hash: "" }
  }

  return {
    beforeHash: path.slice(0, hashIndex),
    hash: path.slice(hashIndex)
  }
}

const querySeparator = (path: string): string => {
  if (!path.includes("?")) {
    return "?"
  }

  return path.endsWith("?") || path.endsWith("&") ? "" : "&"
}

const fetchAction = (
  method: "get" | "post" | "put" | "patch" | "delete",
  url: ExprInput<string>,
  options?: FetchActionOptions
): Expr<void> => {
  if (options === undefined || Object.keys(options).length === 0) {
    return raw(`@${method}(${urlToJs(url)})`)
  }

  return raw(`@${method}(${urlToJs(url)}, ${fetchOptionsToJs(options)})`)
}

export class ActionNameError extends Error {
  constructor(readonly actionName: string) {
    super(`Invalid Datastar action name: ${JSON.stringify(actionName)}`)
  }
}

const actionNamePattern = /^[A-Za-z_$][\w$]*$/

const assertActionName = (name: string): void => {
  if (!actionNamePattern.test(name)) {
    throw new ActionNameError(name)
  }
}

const datastarAction = <T = unknown>(
  name: string,
  ...args: ReadonlyArray<ExprInput<unknown>>
): Expr<T> => {
  assertActionName(name)
  return raw(`@${name}(${args.map((arg) => toJs(arg)).join(", ")})`)
}

/**
 * Builds a Datastar expression for a URL with reactive query parameters.
 *
 * @param path Base path or URL.
 * @param params Query parameter expressions or literal values.
 * @returns A Datastar expression that evaluates to a URL string.
 */
export const queryUrl = (
  path: string,
  params: Readonly<Record<string, ExprInput<string | number | boolean>>>
): Expr<string> => {
  const entries = Object.entries(params)
  if (entries.length === 0) {
    return raw(JSON.stringify(path))
  }

  const { beforeHash, hash } = splitHash(path)
  const separator = querySeparator(beforeHash)
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=\${encodeURIComponent(${toJs(value)})}`)
    .join("&")
  return raw(`\`${escapeTemplateText(beforeHash)}${separator}${query}${escapeTemplateText(hash)}\``)
}

/** Creates a Datastar `@get()` action expression. @see https://data-star.dev/reference/actions#get */
export const get = (url: ExprInput<string>, options?: FetchActionOptions): Expr<void> =>
  fetchAction("get", url, options)

/** Creates a Datastar `@post()` action expression. @see https://data-star.dev/reference/actions#post */
export const post = (url: ExprInput<string>, options?: FetchActionOptions): Expr<void> =>
  fetchAction("post", url, options)

/** Creates a Datastar `@put()` action expression. @see https://data-star.dev/reference/actions#put */
export const put = (url: ExprInput<string>, options?: FetchActionOptions): Expr<void> =>
  fetchAction("put", url, options)

/** Creates a Datastar `@patch()` action expression. @see https://data-star.dev/reference/actions#patch */
export const patch = (url: ExprInput<string>, options?: FetchActionOptions): Expr<void> =>
  fetchAction("patch", url, options)

/** Creates a Datastar `@delete()` action expression. @see https://data-star.dev/reference/actions#delete */
export const del = (url: ExprInput<string>, options?: FetchActionOptions): Expr<void> =>
  fetchAction("delete", url, options)

/**
 * Creates a Datastar `@peek()` action expression.
 *
 * @see https://data-star.dev/reference/actions#peek
 */
export const peek = <T = unknown>(callable: Expr<DatastarFunction<T>>): Expr<T> =>
  datastarAction<T>("peek", callable)

/** Creates a Datastar `@setAll()` action expression. @see https://data-star.dev/reference/actions#setall */
export const setAll = (value: ExprInput<unknown>, filter?: SignalFilter): Expr<void> =>
  filter === undefined ? datastarAction("setAll", value) : datastarAction("setAll", value, filter)

/** Creates a Datastar `@toggleAll()` action expression. @see https://data-star.dev/reference/actions#toggleall */
export const toggleAll = (filter?: SignalFilter): Expr<void> =>
  filter === undefined ? datastarAction("toggleAll") : datastarAction("toggleAll", filter)

/**
 * Creates an expression for an app-defined Datastar action such as `@myAction(...)`.
 *
 * Register the browser action with Datastar's `action(...)` plugin API, then call it from
 * server-rendered attributes without writing the full inline expression string by hand.
 */
export const action = <T = unknown>(
  name: string,
  ...args: ReadonlyArray<ExprInput<unknown>>
): Expr<T> => datastarAction<T>(name, ...args)
