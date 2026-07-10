interface PendingApprovalCheck {
  readonly surfaceId: string
  readonly callId: string
  readonly subject: string
  readonly action: string
  readonly input: unknown
  readonly retryToken?: string
}

type PendingApprovalKey = Pick<PendingApprovalCheck, "surfaceId" | "callId" | "subject">

type PendingApprovalRecord = Pick<PendingApprovalCheck, "subject" | "action"> & {
  readonly inputFingerprint: string
  readonly approvalToken: string
  readonly expiresAt: number
  retryToken?: string
}

type PendingApprovalToken = PendingApprovalKey & { readonly token: string }

interface PendingApprovalOptions {
  readonly now?: () => number
  readonly lifetimeMs?: number
}

const canonicalJson = (input: unknown): string => {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError("Approval input must be JSON-serializable.")
  const normalized: unknown = JSON.parse(serialized)
  const canonical = JSON.stringify(normalized, (_key: string, value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    )
  })
  if (canonical === undefined) throw new TypeError("Approval input must be JSON-serializable.")
  return canonical
}

const approvalKey = ({ surfaceId, callId }: PendingApprovalKey): string =>
  JSON.stringify([surfaceId, callId])

/** Keep short-lived, one-shot consent decisions on the trusted server. */
export const createPendingApprovals = ({
  now = Date.now,
  lifetimeMs = 5 * 60 * 1_000,
}: PendingApprovalOptions = {}) => {
  const records = new Map<string, PendingApprovalRecord>()

  const clearExpired = (): void => {
    const currentTime = now()
    for (const [key, record] of records) {
      if (record.expiresAt <= currentTime) records.delete(key)
    }
  }

  return {
    check(request: PendingApprovalCheck): boolean | undefined {
      clearExpired()
      const key = approvalKey(request)
      const inputFingerprint = canonicalJson(request.input)
      const existing = records.get(key)
      if (existing === undefined) {
        if (request.retryToken !== undefined) return false
        records.set(key, {
          subject: request.subject,
          action: request.action,
          inputFingerprint,
          approvalToken: globalThis.crypto.randomUUID(),
          expiresAt: now() + lifetimeMs,
        })
        return undefined
      }
      if (
        existing.subject !== request.subject ||
        existing.action !== request.action ||
        existing.inputFingerprint !== inputFingerprint
      ) {
        return false
      }
      if (existing.retryToken === undefined)
        return request.retryToken === undefined ? undefined : false
      if (request.retryToken !== existing.retryToken) return false
      records.delete(key)
      return true
    },
    token(request: PendingApprovalKey): string | undefined {
      clearExpired()
      const existing = records.get(approvalKey(request))
      return existing !== undefined &&
        existing.subject === request.subject &&
        existing.retryToken === undefined
        ? existing.approvalToken
        : undefined
    },
    approve(request: PendingApprovalToken): string | false | undefined {
      clearExpired()
      const existing = records.get(approvalKey(request))
      if (existing === undefined || existing.retryToken !== undefined) return undefined
      if (existing.subject !== request.subject || existing.approvalToken !== request.token)
        return false
      existing.retryToken = globalThis.crypto.randomUUID()
      return existing.retryToken
    },
    clear(): void {
      records.clear()
    },
  }
}
