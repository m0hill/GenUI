interface PendingApprovalCheck {
  readonly surfaceId: string
  readonly callId: string
  readonly subject: string
  readonly action: string
  readonly input: unknown
}

interface PendingApprovalKey {
  readonly surfaceId: string
  readonly callId: string
  readonly subject: string
}

interface PendingApprovalRecord {
  readonly subject: string
  readonly action: string
  readonly inputFingerprint: string
  readonly expiresAt: number
  approved: boolean
}

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
        records.set(key, {
          subject: request.subject,
          action: request.action,
          inputFingerprint,
          expiresAt: now() + lifetimeMs,
          approved: false,
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
      if (!existing.approved) return undefined
      records.delete(key)
      return true
    },
    approve(request: PendingApprovalKey): boolean | undefined {
      clearExpired()
      const existing = records.get(approvalKey(request))
      if (existing === undefined) return undefined
      if (existing.subject !== request.subject) return false
      existing.approved = true
      return true
    },
    clear(): void {
      records.clear()
    },
  }
}
