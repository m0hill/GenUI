interface StandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
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
      options?: { readonly libraryOptions?: Readonly<Record<string, unknown>> | undefined },
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  }
}

export type SchemaParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string }

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
  } catch {
    return { ok: false, message: "Value is invalid." }
  }
}
