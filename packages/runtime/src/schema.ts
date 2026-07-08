import type { StandardSchemaIssue, StandardSchemaV1 } from "./types.js"

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
