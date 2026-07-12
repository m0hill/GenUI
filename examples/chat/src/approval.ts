import {
  parseActionCall,
  parseActionResult,
  type ActionCall,
  type ActionResult,
} from "genui/protocol"

export interface ExecuteEnvelope {
  readonly result: ActionResult
  readonly approvalToken?: string
}

export interface ExecuteRequest {
  readonly call: ActionCall
  readonly approvalToken?: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const parseExecuteRequest = (value: unknown): ExecuteRequest | undefined => {
  if (!isRecord(value)) return undefined
  const call = parseActionCall(value.call)
  if (call === undefined) return undefined
  if (value.approvalToken !== undefined && typeof value.approvalToken !== "string") {
    return undefined
  }
  return {
    call,
    ...(value.approvalToken === undefined ? {} : { approvalToken: value.approvalToken }),
  }
}

export const parseExecuteEnvelope = (value: unknown): ExecuteEnvelope | undefined => {
  if (!isRecord(value)) return undefined
  const result = parseActionResult(value.result)
  if (result === undefined) return undefined
  const approvalToken = typeof value.approvalToken === "string" ? value.approvalToken : undefined
  if ((!result.ok && result.error.code === "approval_required") !== (approvalToken !== undefined)) {
    return undefined
  }
  return { result, ...(approvalToken === undefined ? {} : { approvalToken }) }
}

interface PendingApproval {
  readonly fingerprint: string
  readonly token: string
  readonly expiresAt: number
}

const approvals = new Map<string, PendingApproval>()
const approvalKey = (surfaceId: string, callId: string): string =>
  JSON.stringify([surfaceId, callId])

const clearExpired = (): void => {
  const now = Date.now()
  for (const [key, approval] of approvals) {
    if (approval.expiresAt <= now) approvals.delete(key)
  }
}

export const pendingApprovals = {
  check(request: {
    readonly call: ActionCall
    readonly input: unknown
    readonly token?: string
  }): boolean | undefined {
    clearExpired()
    const key = approvalKey(request.call.surfaceId, request.call.callId)
    const fingerprint = JSON.stringify([request.call.action, request.input])
    const existing = approvals.get(key)
    if (existing === undefined) {
      if (request.token !== undefined) return false
      approvals.set(key, {
        fingerprint,
        token: globalThis.crypto.randomUUID(),
        expiresAt: Date.now() + 5 * 60_000,
      })
      return undefined
    }
    if (existing.fingerprint !== fingerprint) return false
    if (request.token === undefined) return undefined
    if (request.token !== existing.token) return false
    approvals.delete(key)
    return true
  },
  token(call: Pick<ActionCall, "surfaceId" | "callId">): string | undefined {
    clearExpired()
    const approval = approvals.get(approvalKey(call.surfaceId, call.callId))
    return approval?.token
  },
  clear(): void {
    approvals.clear()
  },
}
