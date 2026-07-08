import type { StandardSchemaResult, StandardSchemaV1 } from "./types.js"

export type TestSchemaResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string }

export const testSchema = <Value>(
  parse: (value: unknown) => TestSchemaResult<Value>,
): StandardSchemaV1<unknown, Value> => ({
  "~standard": {
    version: 1,
    vendor: "genui-runtime-test",
    validate(value: unknown): StandardSchemaResult<Value> {
      const result = parse(value)
      if (result.ok) return { value: result.value }
      return { issues: [{ message: result.message }] }
    },
  },
})

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
