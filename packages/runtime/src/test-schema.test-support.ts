import type { SchemaParseResult, StandardSchemaV1 } from "./schema.js"

export { isRecord } from "./test-support.test-support.js"

export const testSchema = <Value>(
  parse: (value: unknown) => SchemaParseResult<Value>,
): StandardSchemaV1<unknown, Value> => ({
  "~standard": {
    version: 1,
    vendor: "genui-runtime-test",
    validate(value: unknown) {
      const result = parse(value)
      if (result.ok) return { value: result.value }
      return { issues: [{ message: result.message }] }
    },
  },
})
