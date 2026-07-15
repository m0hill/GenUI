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
  readonly action: string
  readonly input: unknown
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
  if (!isRecord(value) || !hasOnlyKeys(value, ["surfaceId", "callId", "action", "input", "token"]))
    return undefined
  const call = parseActionCall(value)
  if (
    call === undefined ||
    call.surfaceId.length === 0 ||
    call.surfaceId.length > 256 ||
    call.callId.length === 0 ||
    call.callId.length > 256 ||
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    value.token.length > 256
  )
    return undefined
  try {
    const input: unknown = JSON.parse(canonicalJson(call.input))
    return { ...call, input, token: value.token }
  } catch {
    return undefined
  }
}

export const parseExecuteRequest = (value: unknown): ExecuteRequest | undefined => {
  if (!isRecord(value)) return undefined
  const hasRetryToken = Object.hasOwn(value, "approvalRetryToken")
  const allowed = hasRetryToken ? ["call", "approvalRetryToken"] : ["call"]
  if (!hasOnlyKeys(value, allowed)) return undefined
  if (!isRecord(value.call) || !hasOnlyKeys(value.call, ["surfaceId", "callId", "action", "input"]))
    return undefined
  const call = parseActionCall(value.call)
  const approvalRetryToken =
    hasRetryToken && typeof value.approvalRetryToken === "string"
      ? value.approvalRetryToken
      : undefined
  if (
    call === undefined ||
    call.surfaceId.length === 0 ||
    call.surfaceId.length > 256 ||
    call.callId.length === 0 ||
    call.callId.length > 256 ||
    (hasRetryToken &&
      (approvalRetryToken === undefined ||
        approvalRetryToken.length === 0 ||
        approvalRetryToken.length > 256))
  ) {
    return undefined
  }
  if (!hasRetryToken) return { call }
  return approvalRetryToken === undefined ? undefined : { call, approvalRetryToken }
}

export const parseExecuteEnvelope = (
  value: unknown,
  call: Pick<ActionCall, "surfaceId" | "callId" | "action">,
): ExecuteEnvelope | undefined => {
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
  if (
    pendingApproval !== undefined &&
    (pendingApproval.surfaceId !== call.surfaceId ||
      pendingApproval.callId !== call.callId ||
      pendingApproval.action !== call.action)
  )
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
  isRecord(value) &&
  hasOnlyKeys(value, ["retryToken"]) &&
  typeof value.retryToken === "string" &&
  value.retryToken.length > 0 &&
  value.retryToken.length <= 256
    ? { retryToken: value.retryToken }
    : undefined

interface ApprovalRecord {
  readonly subject: string
  readonly action: string
  readonly input: unknown
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
    matchesRetry(request: {
      readonly subject: string
      readonly call: Pick<ActionCall, "surfaceId" | "callId" | "action">
      readonly retryToken: string
    }): boolean {
      clearExpired()
      const approval = approvals.get(approvalKey(request.call.surfaceId, request.call.callId))
      return (
        approval !== undefined &&
        approval.subject === request.subject &&
        approval.action === request.call.action &&
        approval.retryToken === request.retryToken
      )
    },
    check(request: {
      readonly subject: string
      readonly call: ActionCall
      readonly input: unknown
      readonly retryToken?: string
    }): "pending" | "rejected" | "approved" {
      clearExpired()
      const key = approvalKey(request.call.surfaceId, request.call.callId)
      const inputFingerprint = canonicalJson(request.input)
      const approval = approvals.get(key)
      if (approval === undefined) {
        if (request.retryToken !== undefined) return "rejected"
        const canonicalInput: unknown = JSON.parse(inputFingerprint)
        approvals.set(key, {
          subject: request.subject,
          action: request.call.action,
          input: canonicalInput,
          inputFingerprint,
          pendingToken: globalThis.crypto.randomUUID(),
          expiresAt: now() + lifetimeMs,
        })
        return "pending"
      }
      if (
        approval.subject !== request.subject ||
        approval.action !== request.call.action ||
        approval.inputFingerprint !== inputFingerprint
      )
        return "rejected"
      if (approval.retryToken === undefined)
        return request.retryToken === undefined ? "pending" : "rejected"
      if (approval.retryToken !== request.retryToken) return "rejected"
      approvals.delete(key)
      return "approved"
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
        : {
            surfaceId: call.surfaceId,
            callId: call.callId,
            action: approval.action,
            input: approval.input,
            token: approval.pendingToken,
          }
    },
    exchange(request: PendingApprovalEnvelope, subject: string): string | false | undefined {
      clearExpired()
      const approval = approvals.get(approvalKey(request.surfaceId, request.callId))
      if (approval === undefined || approval.retryToken !== undefined) return undefined
      let inputFingerprint: string
      try {
        inputFingerprint = canonicalJson(request.input)
      } catch {
        return false
      }
      if (
        approval.subject !== subject ||
        approval.action !== request.action ||
        approval.inputFingerprint !== inputFingerprint ||
        approval.pendingToken !== request.token
      )
        return false
      approval.retryToken = globalThis.crypto.randomUUID()
      return approval.retryToken
    },
    clear(): void {
      approvals.clear()
    },
  }
}

export const pendingApprovals = createPendingApprovals()
