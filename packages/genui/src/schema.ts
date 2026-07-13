import type { JsonSchema } from "./protocol/index.js"

interface StandardSchemaIssue {
  readonly message: string
}

type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] }

/** Vendored structural subset accepts Standard Schema validators without a validator dependency. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  }
}

export type SchemaParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string; readonly cause?: unknown }

/** Sever app-owned references before a model-facing schema crosses a runtime boundary. */
export const copyJsonSchema = (schema: JsonSchema): JsonSchema => {
  const serialized = JSON.stringify(schema)
  if (serialized === undefined) throw new TypeError("JSON Schema must be JSON-serializable.")

  const value: unknown = JSON.parse(serialized)
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("JSON Schema must serialize to an object.")
  }

  // SAFETY: the input contract is a JSON object and the round trip preserves that shape.
  return value as JsonSchema
}

const issueMessage = (issue: StandardSchemaIssue | undefined): string =>
  issue?.message && issue.message.trim().length > 0 ? issue.message : "Value is invalid."

export const parseWithSchema = async <Value>(
  schema: StandardSchemaV1<unknown, Value>,
  value: unknown,
): Promise<SchemaParseResult<Value>> => {
  try {
    const result = await schema["~standard"].validate(value)
    if ("value" in result) return { ok: true, value: result.value }

    return { ok: false, message: issueMessage(result.issues[0]) }
  } catch (cause) {
    return { ok: false, message: "Value is invalid.", cause }
  }
}
