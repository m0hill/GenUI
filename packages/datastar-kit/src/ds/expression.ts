/**
 * A value that can render itself as Datastar expression source.
 *
 * @typeParam T The JavaScript value produced when Datastar evaluates the expression.
 */
export interface Expr<T = unknown> {
  /** Phantom type marker for the JavaScript value produced by this expression. */
  readonly valueType?: T
  /** Serializes this value into Datastar expression source. */
  toDatastarExpression(): string
}

/**
 * Either a Datastar expression or a literal value accepted where that expression is expected.
 *
 * @typeParam T Literal value type accepted by the expression site.
 */
export type ExprInput<T> = Expr<T> | T

/**
 * A callable value represented inside a Datastar expression.
 *
 * @typeParam T Return value produced by the function.
 */
export type DatastarFunction<T = unknown> = (...args: ReadonlyArray<unknown>) => T

class RawExpr<T = unknown> implements Expr<T> {
  constructor(private readonly code: string) {}

  toDatastarExpression(): string {
    return this.code
  }

  toString(): string {
    return this.code
  }
}

export const raw = <T = unknown>(code: string): Expr<T> => new RawExpr<T>(code)

export const isExpr = (value: unknown): value is Expr =>
  typeof value === "object" && value !== null && "toDatastarExpression" in value

export const toJs = (value: ExprInput<unknown>): string => {
  if (isExpr(value)) {
    return value.toDatastarExpression()
  }

  if (value === undefined) {
    return "undefined"
  }

  if (typeof value === "string") {
    return JSON.stringify(value)
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value)
  }

  if (value instanceof RegExp) {
    return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => toJs(item)).join(", ")}]`
  }

  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${toJs(item)}`)
      .join(", ")}}`
  }

  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    return JSON.stringify(String(value))
  }

  return JSON.stringify("")
}

/**
 * Wraps raw Datastar expression source.
 *
 * @typeParam T JavaScript value produced when Datastar evaluates the expression.
 * @param code Datastar expression source.
 * @returns A typed Datastar expression.
 */
export function js<T = unknown>(code: string): Expr<T>

/**
 * Builds Datastar expression source from a template with safely serialized interpolations.
 *
 * @typeParam T JavaScript value produced when Datastar evaluates the expression.
 * @param parts Template literal string parts.
 * @param values Values interpolated as Datastar expression source or JavaScript literals.
 * @returns A typed Datastar expression.
 */
export function js<T = unknown>(
  parts: TemplateStringsArray,
  ...values: ReadonlyArray<ExprInput<unknown>>
): Expr<T>

export function js<T = unknown>(
  codeOrParts: string | TemplateStringsArray,
  ...values: ReadonlyArray<ExprInput<unknown>>
): Expr<T> {
  if (typeof codeOrParts === "string") {
    return raw<T>(codeOrParts)
  }

  let code = codeOrParts[0] ?? ""
  for (const [index, value] of values.entries()) {
    code += `${toJs(value)}${codeOrParts[index + 1] ?? ""}`
  }
  return raw<T>(code)
}

/**
 * Error thrown when `regex(...)` receives a pattern or flags pair that cannot create a `RegExp`.
 */
export class RegexExpressionError extends Error {
  constructor(
    readonly pattern: string,
    readonly flags: string,
    options: { readonly cause?: unknown } = {}
  ) {
    super(`Invalid regular expression: ${JSON.stringify(pattern)}`, options)
  }
}

/**
 * Creates a regular-expression literal for Datastar expression options.
 *
 * @param pattern Regular expression pattern.
 * @param flags Regular expression flags.
 * @returns A Datastar expression that evaluates to a `RegExp`.
 */
export const regex = (pattern: string, flags = ""): Expr<RegExp> => {
  try {
    RegExp(pattern, flags)
  } catch (cause) {
    throw new RegexExpressionError(pattern, flags, { cause })
  }

  return raw(`new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)})`)
}
