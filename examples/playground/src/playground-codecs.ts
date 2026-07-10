import type { CallAuditEntry } from "@genui/genui"
import type { SurfaceEvent } from "@genui/genui/dom"
import {
  parseActionCall,
  parseActionResult,
  type ActionCall,
  type ActionResult,
  type SurfaceInput,
} from "@genui/genui/protocol"

export interface ExecuteEnvelope {
  readonly result: ActionResult
  readonly audit: readonly CallAuditEntry[]
}

export type PlaygroundEvent =
  | SurfaceEvent
  | { readonly type: "audit"; readonly entry: CallAuditEntry }

export const parseRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  // SAFETY: any non-null, non-array object can be read through string property keys.
  return value as Readonly<Record<string, unknown>>
}

const parseEffect = (value: unknown): CallAuditEntry["effect"] | undefined =>
  value === "local" ||
  value === "read" ||
  value === "write" ||
  value === "dangerous" ||
  value === "unknown"
    ? value
    : undefined

const parseOutcome = (value: unknown): CallAuditEntry["outcome"] | undefined => {
  if (value === "ok") return value
  if (typeof value !== "string") return undefined
  const result = parseActionResult({ ok: false, error: { code: value, message: "" } })
  return result?.ok === false ? result.error.code : undefined
}

const parseAuditEntry = (value: unknown): CallAuditEntry | undefined => {
  const record = parseRecord(value)
  if (record === undefined) return undefined
  if (typeof record.surfaceId !== "string" || typeof record.callId !== "string") return undefined
  if (typeof record.action !== "string") return undefined
  const effect = parseEffect(record.effect)
  const outcome = parseOutcome(record.outcome)
  if (effect === undefined || outcome === undefined) return undefined
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return undefined
  if (record.subject !== undefined && typeof record.subject !== "string") return undefined
  return {
    surfaceId: record.surfaceId,
    callId: record.callId,
    ...(record.subject === undefined ? {} : { subject: record.subject }),
    action: record.action,
    effect,
    outcome,
    at: record.at,
  }
}

export const parseExecuteEnvelope = (value: unknown): ExecuteEnvelope | undefined => {
  const record = parseRecord(value)
  if (record === undefined || !Array.isArray(record.audit)) return undefined
  const result = parseActionResult(record.result)
  if (result === undefined) return undefined
  const audit: CallAuditEntry[] = []
  for (const entryValue of record.audit) {
    const entry = parseAuditEntry(entryValue)
    if (entry === undefined) return undefined
    audit.push(entry)
  }
  return { result, audit }
}

export const parseSurfaceRequest = (value: unknown): Pick<SurfaceInput, "content"> | undefined => {
  const record = parseRecord(value)
  return record !== undefined && typeof record.content === "string"
    ? { content: record.content }
    : undefined
}

export const parseExecuteRequest = (
  value: unknown,
):
  | {
      readonly call: ActionCall
      readonly hasApprovedField: boolean
    }
  | undefined => {
  const record = parseRecord(value)
  if (record === undefined) return undefined
  const call = parseActionCall(record.call)
  return call === undefined
    ? undefined
    : { call, hasApprovedField: Object.hasOwn(record, "approved") }
}

export const parseApprovalRequest = (
  value: unknown,
): Pick<ActionCall, "surfaceId" | "callId"> | undefined => {
  const record = parseRecord(value)
  return record !== undefined &&
    typeof record.surfaceId === "string" &&
    typeof record.callId === "string"
    ? { surfaceId: record.surfaceId, callId: record.callId }
    : undefined
}

export const decodeExpectedCalls = (
  value: unknown,
): readonly Pick<ActionCall, "action" | "input">[] => {
  if (!Array.isArray(value)) throw new Error("Expected calls must be a JSON array.")

  return value.map((item, index) => {
    const record = parseRecord(item)
    if (
      record === undefined ||
      Object.keys(record).length !== 2 ||
      typeof record.action !== "string" ||
      !Object.hasOwn(record, "input")
    ) {
      throw new Error(`Expected call ${index + 1} must contain only action and input.`)
    }
    return { action: record.action, input: record.input }
  })
}

export const parsePlaygroundEvent = (value: unknown): PlaygroundEvent | undefined => {
  const record = parseRecord(value)
  if (record === undefined) return undefined

  switch (record.type) {
    case "call": {
      const call = parseActionCall(record.call)
      return call === undefined ? undefined : { type: "call", call }
    }
    case "result": {
      if (typeof record.callId !== "string" || typeof record.action !== "string") {
        return undefined
      }
      const result = parseActionResult(record.result)
      return result === undefined
        ? undefined
        : { type: "result", callId: record.callId, action: record.action, result }
    }
    case "resize":
      return typeof record.height === "number" && Number.isFinite(record.height)
        ? { type: "resize", height: record.height }
        : undefined
    case "guest_error":
      if (
        typeof record.message !== "string" ||
        (record.stack !== undefined && typeof record.stack !== "string")
      ) {
        return undefined
      }
      return {
        type: "guest_error",
        message: record.message,
        ...(record.stack === undefined ? {} : { stack: record.stack }),
      }
    case "violation": {
      const reason: Extract<SurfaceEvent, { type: "violation" }>["reason"] | undefined =
        record.reason === "bad_message" ||
        record.reason === "ungranted_call" ||
        record.reason === "navigation" ||
        record.reason === "unresponsive" ||
        record.reason === "snapshot_timeout"
          ? record.reason
          : undefined
      if (
        reason === undefined ||
        (record.detail !== undefined && typeof record.detail !== "string")
      ) {
        return undefined
      }
      return {
        type: "violation",
        reason,
        ...(record.detail === undefined ? {} : { detail: record.detail }),
      }
    }
    case "audit": {
      const entry = parseAuditEntry(record.entry)
      return entry === undefined ? undefined : { type: "audit", entry }
    }
    default:
      return undefined
  }
}
