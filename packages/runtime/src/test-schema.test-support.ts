import type { SchemaParseResult } from "./schema.js"
import type { StandardSchemaResult, StandardSchemaV1 } from "./types.js"

export { isRecord } from "./test-support.test-support.js"

export const testSchema = <Value>(
  parse: (value: unknown) => SchemaParseResult<Value>,
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
