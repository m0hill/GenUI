export { isRecord } from "./record.js"

export const jsonRoundTrip = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
