export { isRecord } from "./dom/sandbox-message-schema.js"

export const jsonRoundTrip = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
