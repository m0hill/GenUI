import type { CallAuditEntry } from "@genui/genui"
import { parseActionResult, type ActionResult } from "@genui/protocol"

export interface ExecuteEnvelope {
  readonly result: ActionResult
  readonly audit: readonly CallAuditEntry[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEffect = (value: unknown): value is CallAuditEntry["effect"] =>
  value === "local" ||
  value === "read" ||
  value === "write" ||
  value === "dangerous" ||
  value === "unknown"

const isOutcome = (value: unknown): value is CallAuditEntry["outcome"] =>
  value === "ok" ||
  (typeof value === "string" &&
    parseActionResult({ ok: false, error: { code: value, message: "" } }) !== undefined)

const parseAuditEntry = (value: unknown): CallAuditEntry | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.surfaceId !== "string" || typeof value.callId !== "string") return undefined
  if (typeof value.action !== "string" || !isEffect(value.effect) || !isOutcome(value.outcome)) {
    return undefined
  }
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return undefined
  if (value.subject !== undefined && typeof value.subject !== "string") return undefined
  return {
    surfaceId: value.surfaceId,
    callId: value.callId,
    ...(value.subject === undefined ? {} : { subject: value.subject }),
    action: value.action,
    effect: value.effect,
    outcome: value.outcome,
    at: value.at,
  }
}

/** Parse the playground's server result plus observational audit metadata. */
export const parseExecuteEnvelope = (value: unknown): ExecuteEnvelope | undefined => {
  if (!isRecord(value) || !Array.isArray(value.audit)) return undefined
  const result = parseActionResult(value.result)
  if (result === undefined) return undefined
  const audit: CallAuditEntry[] = []
  for (const entryValue of value.audit) {
    const entry = parseAuditEntry(entryValue)
    if (entry === undefined) return undefined
    audit.push(entry)
  }
  return { result, audit }
}
