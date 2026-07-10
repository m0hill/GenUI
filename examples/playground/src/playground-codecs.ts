import type { CallAuditEntry } from "genui"
import type { SurfaceEvent } from "genui/dom"
import {
  parseActionCall,
  parseActionResult,
  parseSubscriptionError,
  type ActionCall,
  type ActionResult,
  type SubscriptionOpenResult,
  type SurfaceInput,
} from "genui/protocol"

export interface ExecuteEnvelope {
  readonly result: ActionResult
  readonly audit: readonly CallAuditEntry[]
  readonly approvalToken?: string
}

export type SubscriptionOpenFailure = Extract<SubscriptionOpenResult, { readonly ok: false }>

type CapabilityCallEvent = Extract<SurfaceEvent, { readonly type: "capability_call" }>
type CapabilityResultEvent = Extract<SurfaceEvent, { readonly type: "capability_result" }>
type HostCapability = CapabilityCallEvent["call"]["capability"]
type CapabilityOutcome = CapabilityResultEvent["outcome"]
type SubscriptionClosedEvent = Extract<SurfaceEvent, { readonly type: "subscription_closed" }>

export type PlaygroundHostCapabilityEvent =
  | {
      readonly type: "host_capability"
      readonly capability: "sendMessage"
      readonly provenance: "generated_surface"
      readonly role: "user"
      readonly textLength: number
    }
  | {
      readonly type: "host_capability"
      readonly capability: "openLink"
      readonly provenance: "generated_surface"
      readonly url: string
    }
  | {
      readonly type: "host_capability"
      readonly capability: "updateModelContext"
      readonly provenance: "generated_surface"
      readonly contentLength: number
      readonly structuredContentKeys: readonly string[]
    }

export interface PlaygroundHostTeardownEvent {
  readonly type: "host_teardown"
  readonly reason: "surface_replaced"
  readonly snapshotCaptured: boolean
}

export type PlaygroundEvent =
  | SurfaceEvent
  | PlaygroundHostCapabilityEvent
  | PlaygroundHostTeardownEvent
  | { readonly type: "audit"; readonly entry: CallAuditEntry }

export interface ExecuteRequest {
  readonly call: ActionCall
  readonly approvalRetryToken?: string
}

export const parseRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  // SAFETY: any non-null, non-array object can be read through string property keys.
  return value as Readonly<Record<string, unknown>>
}

const hasExactKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

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

const parseHostCapability = (value: unknown): HostCapability | undefined =>
  value === "sendMessage" || value === "openLink" || value === "updateModelContext"
    ? value
    : undefined

const parseCapabilityOutcome = (value: unknown): CapabilityOutcome | undefined =>
  value === "ok" ||
  value === "not_available" ||
  value === "denied" ||
  value === "invalid_input" ||
  value === "rate_limited" ||
  value === "superseded"
    ? value
    : undefined

const parseSubscriptionCloseReason = (
  value: unknown,
): SubscriptionClosedEvent["reason"] | undefined => {
  if (
    value === "completed" ||
    value === "unsubscribed" ||
    value === "replaced" ||
    value === "disposed" ||
    value === "terminated"
  ) {
    return value
  }
  if (typeof value !== "string") return undefined
  return parseSubscriptionError({ code: value, message: "" })?.code
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

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
  const approvalRequired = !result.ok && result.error.code === "approval_required"
  const approvalToken = typeof record.approvalToken === "string" ? record.approvalToken : undefined
  if (approvalRequired !== (approvalToken !== undefined)) return undefined
  const audit: CallAuditEntry[] = []
  for (const entryValue of record.audit) {
    const entry = parseAuditEntry(entryValue)
    if (entry === undefined) return undefined
    audit.push(entry)
  }
  return {
    result,
    audit,
    ...(approvalToken === undefined ? {} : { approvalToken }),
  }
}

export const parseSubscriptionOpenFailure = (
  value: unknown,
): SubscriptionOpenFailure | undefined => {
  const record = parseRecord(value)
  if (record === undefined || !hasExactKeys(record, ["ok", "error"]) || record.ok !== false) {
    return undefined
  }
  const error = parseSubscriptionError(record.error)
  return error === undefined ? undefined : { ok: false, error }
}

export const parseSurfaceRequest = (value: unknown): Pick<SurfaceInput, "content"> | undefined => {
  const record = parseRecord(value)
  return record !== undefined && typeof record.content === "string"
    ? { content: record.content }
    : undefined
}

export const parseExecuteRequest = (value: unknown): ExecuteRequest | undefined => {
  const record = parseRecord(value)
  if (record === undefined) return undefined
  const call = parseActionCall(record.call)
  if (call === undefined) return undefined
  if (record.approvalRetryToken !== undefined && typeof record.approvalRetryToken !== "string") {
    return undefined
  }
  return {
    call,
    ...(record.approvalRetryToken === undefined
      ? {}
      : { approvalRetryToken: record.approvalRetryToken }),
  }
}

export const parseApprovalResponse = (
  value: unknown,
): { readonly retryToken: string } | undefined => {
  const record = parseRecord(value)
  return record !== undefined && typeof record.retryToken === "string"
    ? { retryToken: record.retryToken }
    : undefined
}

export const parseApprovalRequest = (
  value: unknown,
): (Pick<ActionCall, "surfaceId" | "callId"> & { readonly token: string }) | undefined => {
  const record = parseRecord(value)
  return record !== undefined &&
    typeof record.surfaceId === "string" &&
    typeof record.callId === "string" &&
    typeof record.token === "string"
    ? { surfaceId: record.surfaceId, callId: record.callId, token: record.token }
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
    case "capability_call": {
      const call = parseRecord(record.call)
      const capability = parseHostCapability(call?.capability)
      if (
        call === undefined ||
        typeof call.surfaceId !== "string" ||
        typeof call.callId !== "string" ||
        capability === undefined ||
        !isNonNegativeInteger(record.payloadBytes)
      ) {
        return undefined
      }
      return {
        type: "capability_call",
        call: { surfaceId: call.surfaceId, callId: call.callId, capability },
        payloadBytes: record.payloadBytes,
      }
    }
    case "capability_result": {
      const capability = parseHostCapability(record.capability)
      const outcome = parseCapabilityOutcome(record.outcome)
      return typeof record.callId === "string" && capability !== undefined && outcome !== undefined
        ? { type: "capability_result", callId: record.callId, capability, outcome }
        : undefined
    }
    case "host_capability": {
      if (record.provenance !== "generated_surface") return undefined
      if (record.capability === "sendMessage") {
        return record.role === "user" && isNonNegativeInteger(record.textLength)
          ? {
              type: "host_capability",
              capability: "sendMessage",
              provenance: "generated_surface",
              role: "user",
              textLength: record.textLength,
            }
          : undefined
      }
      if (record.capability === "openLink") {
        return typeof record.url === "string"
          ? {
              type: "host_capability",
              capability: "openLink",
              provenance: "generated_surface",
              url: record.url,
            }
          : undefined
      }
      if (record.capability === "updateModelContext") {
        if (
          !isNonNegativeInteger(record.contentLength) ||
          !Array.isArray(record.structuredContentKeys) ||
          !record.structuredContentKeys.every((key) => typeof key === "string")
        ) {
          return undefined
        }
        return {
          type: "host_capability",
          capability: "updateModelContext",
          provenance: "generated_surface",
          contentLength: record.contentLength,
          structuredContentKeys: record.structuredContentKeys,
        }
      }
      return undefined
    }
    case "host_teardown":
      return record.reason === "surface_replaced" && typeof record.snapshotCaptured === "boolean"
        ? {
            type: "host_teardown",
            reason: "surface_replaced",
            snapshotCaptured: record.snapshotCaptured,
          }
        : undefined
    case "subscription_start":
      return hasExactKeys(record, [
        "type",
        "surfaceId",
        "subscriptionId",
        "subscription",
        "inputBytes",
      ]) &&
        typeof record.surfaceId === "string" &&
        typeof record.subscriptionId === "string" &&
        typeof record.subscription === "string" &&
        isNonNegativeInteger(record.inputBytes)
        ? {
            type: "subscription_start",
            surfaceId: record.surfaceId,
            subscriptionId: record.subscriptionId,
            subscription: record.subscription,
            inputBytes: record.inputBytes,
          }
        : undefined
    case "subscription_opened":
      return hasExactKeys(record, ["type", "surfaceId", "subscriptionId", "subscription"]) &&
        typeof record.surfaceId === "string" &&
        typeof record.subscriptionId === "string" &&
        typeof record.subscription === "string"
        ? {
            type: "subscription_opened",
            surfaceId: record.surfaceId,
            subscriptionId: record.subscriptionId,
            subscription: record.subscription,
          }
        : undefined
    case "subscription_event":
      return hasExactKeys(record, [
        "type",
        "surfaceId",
        "subscriptionId",
        "subscription",
        "sequence",
        "payloadBytes",
      ]) &&
        typeof record.surfaceId === "string" &&
        typeof record.subscriptionId === "string" &&
        typeof record.subscription === "string" &&
        isNonNegativeInteger(record.sequence) &&
        record.sequence > 0 &&
        isNonNegativeInteger(record.payloadBytes)
        ? {
            type: "subscription_event",
            surfaceId: record.surfaceId,
            subscriptionId: record.subscriptionId,
            subscription: record.subscription,
            sequence: record.sequence,
            payloadBytes: record.payloadBytes,
          }
        : undefined
    case "subscription_closed": {
      const reason = parseSubscriptionCloseReason(record.reason)
      return hasExactKeys(record, [
        "type",
        "surfaceId",
        "subscriptionId",
        "subscription",
        "reason",
        "eventCount",
        "payloadBytes",
        "durationMs",
      ]) &&
        typeof record.surfaceId === "string" &&
        typeof record.subscriptionId === "string" &&
        typeof record.subscription === "string" &&
        reason !== undefined &&
        isNonNegativeInteger(record.eventCount) &&
        isNonNegativeInteger(record.payloadBytes) &&
        isNonNegativeFiniteNumber(record.durationMs)
        ? {
            type: "subscription_closed",
            surfaceId: record.surfaceId,
            subscriptionId: record.subscriptionId,
            subscription: record.subscription,
            reason,
            eventCount: record.eventCount,
            payloadBytes: record.payloadBytes,
            durationMs: record.durationMs,
          }
        : undefined
    }
    case "resize":
      return isNonNegativeFiniteNumber(record.width) && isNonNegativeFiniteNumber(record.height)
        ? { type: "resize", width: record.width, height: record.height }
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
        record.reason === "ungranted_subscription" ||
        record.reason === "navigation" ||
        record.reason === "unresponsive" ||
        record.reason === "snapshot_timeout" ||
        record.reason === "teardown_timeout"
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
