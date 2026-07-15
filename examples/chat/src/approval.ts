import {
  parseActionCall,
  parseActionResult,
  type ActionCall,
  type ActionResult,
} from "genui/protocol"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const canonicalJson = (input: unknown): string => {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError("Approval input must be JSON-serializable.")
  const canonical = JSON.stringify(JSON.parse(serialized), (_key, value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    )
  })
  if (canonical === undefined) throw new TypeError("Approval input must be JSON-serializable.")
  return canonical
}

export interface PendingApprovalEnvelope {
  readonly surfaceId: string
  readonly callId: string
  readonly token: string
}

export interface ExecuteEnvelope {
  readonly result: ActionResult
  readonly pendingApproval?: PendingApprovalEnvelope
}

export interface ExecuteRequest {
  readonly call: ActionCall
  readonly approvalRetryToken?: string
}

export interface ApprovalExchangeRequest {
  readonly pendingApproval: PendingApprovalEnvelope
}

export interface ApprovalResponse {
  readonly retryToken: string
}

const parsePendingApprovalEnvelope = (value: unknown): PendingApprovalEnvelope | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["surfaceId", "callId", "token"])) return undefined
  return typeof value.surfaceId === "string" &&
    typeof value.callId === "string" &&
    typeof value.token === "string"
    ? { surfaceId: value.surfaceId, callId: value.callId, token: value.token }
    : undefined
}

export const parseExecuteRequest = (value: unknown): ExecuteRequest | undefined => {
  if (!isRecord(value)) return undefined
  const allowed = value.approvalRetryToken === undefined ? ["call"] : ["call", "approvalRetryToken"]
  if (!hasOnlyKeys(value, allowed)) return undefined
  const call = parseActionCall(value.call)
  if (
    call === undefined ||
    (value.approvalRetryToken !== undefined && typeof value.approvalRetryToken !== "string")
  ) {
    return undefined
  }
  return {
    call,
    ...(value.approvalRetryToken === undefined
      ? {}
      : { approvalRetryToken: value.approvalRetryToken }),
  }
}

export const parseExecuteEnvelope = (value: unknown): ExecuteEnvelope | undefined => {
  if (!isRecord(value)) return undefined
  const result = parseActionResult(value.result)
  const pendingApproval = parsePendingApprovalEnvelope(value.pendingApproval)
  if (
    result === undefined ||
    !hasOnlyKeys(value, pendingApproval === undefined ? ["result"] : ["result", "pendingApproval"])
  ) {
    return undefined
  }
  if ((!result.ok && result.error.code === "approval_required") !== (pendingApproval !== undefined))
    return undefined
  return { result, ...(pendingApproval === undefined ? {} : { pendingApproval }) }
}

export const parseApprovalExchangeRequest = (
  value: unknown,
): ApprovalExchangeRequest | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["pendingApproval"])) return undefined
  const pendingApproval = parsePendingApprovalEnvelope(value.pendingApproval)
  return pendingApproval === undefined ? undefined : { pendingApproval }
}

export const parseApprovalResponse = (value: unknown): ApprovalResponse | undefined =>
  isRecord(value) && hasOnlyKeys(value, ["retryToken"]) && typeof value.retryToken === "string"
    ? { retryToken: value.retryToken }
    : undefined

interface ApprovalRecord {
  readonly subject: string
  readonly action: string
  readonly inputFingerprint: string
  readonly pendingToken: string
  readonly expiresAt: number
  retryToken?: string
}

const approvalKey = (surfaceId: string, callId: string): string =>
  JSON.stringify([surfaceId, callId])

/** Chat's in-memory, single-process approval authority. */
export const createPendingApprovals = (
  options: { readonly now?: () => number; readonly lifetimeMs?: number } = {},
) => {
  const now = options.now ?? Date.now
  const lifetimeMs = options.lifetimeMs ?? 5 * 60_000
  const approvals = new Map<string, ApprovalRecord>()
  const clearExpired = (): void => {
    for (const [key, approval] of approvals) if (approval.expiresAt <= now()) approvals.delete(key)
  }

  return {
    check(request: {
      readonly subject: string
      readonly call: ActionCall
      readonly input: unknown
      readonly retryToken?: string
    }): boolean | undefined {
      clearExpired()
      const key = approvalKey(request.call.surfaceId, request.call.callId)
      const inputFingerprint = canonicalJson(request.input)
      const approval = approvals.get(key)
      if (approval === undefined) {
        if (request.retryToken !== undefined) return false
        approvals.set(key, {
          subject: request.subject,
          action: request.call.action,
          inputFingerprint,
          pendingToken: globalThis.crypto.randomUUID(),
          expiresAt: now() + lifetimeMs,
        })
        return undefined
      }
      if (
        approval.subject !== request.subject ||
        approval.action !== request.call.action ||
        approval.inputFingerprint !== inputFingerprint
      )
        return false
      if (approval.retryToken === undefined)
        return request.retryToken === undefined ? undefined : false
      if (approval.retryToken !== request.retryToken) return false
      approvals.delete(key)
      return true
    },
    pending(
      call: Pick<ActionCall, "surfaceId" | "callId">,
      subject: string,
    ): PendingApprovalEnvelope | undefined {
      clearExpired()
      const approval = approvals.get(approvalKey(call.surfaceId, call.callId))
      return approval === undefined ||
        approval.subject !== subject ||
        approval.retryToken !== undefined
        ? undefined
        : { surfaceId: call.surfaceId, callId: call.callId, token: approval.pendingToken }
    },
    exchange(request: PendingApprovalEnvelope, subject: string): string | false | undefined {
      clearExpired()
      const approval = approvals.get(approvalKey(request.surfaceId, request.callId))
      if (approval === undefined || approval.retryToken !== undefined) return undefined
      if (approval.subject !== subject || approval.pendingToken !== request.token) return false
      approval.retryToken = globalThis.crypto.randomUUID()
      return approval.retryToken
    },
    clear(): void {
      approvals.clear()
    },
  }
}

export const pendingApprovals = createPendingApprovals()
