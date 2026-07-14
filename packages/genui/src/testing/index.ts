import {
  maxSurfaceContentBytes,
  subscriptionEventByteLimit,
  type ActionResult,
  type MaybePromise,
  type SurfaceRecord,
} from "../protocol/index.js"
import type {
  SurfaceStore,
  SurfaceStoreIdempotencyRequest,
  SurfaceStoreIdempotencyResult,
} from "../types.js"

export type SurfaceStoreFactory = () => MaybePromise<SurfaceStore>

const fail = (message: string): never => {
  throw new Error(`SurfaceStore conformance failed: ${message}`)
}

const canonicalJson = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, nested: unknown): unknown => {
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    )
  })

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(message)
}

const runIdempotent = async (
  store: SurfaceStore,
  request: SurfaceStoreIdempotencyRequest,
  operation: () => Promise<ActionResult>,
): Promise<SurfaceStoreIdempotencyResult> => await store.runIdempotent(request, operation)

/**
 * Assert the persistence and atomic idempotency contract required of a SurfaceStore.
 * The factory is called twice and both adapters must share one isolated backend namespace.
 */
export const assertSurfaceStoreConformance = async (
  createStore: SurfaceStoreFactory,
): Promise<void> => {
  const primary = await createStore()
  const peer = await createStore()
  const namespace = `genui-store-${globalThis.crypto.randomUUID()}`
  const surfaceId = `${namespace}-surface`
  const subscriptionName = "records.changes"
  const boundaryContent = `${"界".repeat(Math.floor(maxSurfaceContentBytes / 3))}x`
  if (
    boundaryContent.length >= maxSurfaceContentBytes ||
    new TextEncoder().encode(boundaryContent).byteLength !== maxSurfaceContentBytes
  ) {
    fail("the UTF-8 boundary fixture must contain exactly maxSurfaceContentBytes bytes")
  }
  const record: SurfaceRecord = {
    surface: {
      id: surfaceId,
      content: boundaryContent,
      dialect: "code/0",
      grant: {
        surfaceId,
        subject: "subject-1",
        actions: [],
        subscriptions: [
          {
            name: subscriptionName,
            description: "Receive changes to matching records.",
            confidentiality: "normal",
            maxEventBytes: subscriptionEventByteLimit,
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "object",
                  properties: { status: { type: "string" } },
                  required: ["status"],
                },
              },
              required: ["filter"],
            },
            eventSchema: {
              type: "object",
              properties: {
                record: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                  },
                  required: ["id", "status"],
                },
              },
              required: ["record"],
            },
          },
        ],
      },
    },
    source: {
      content: boundaryContent,
      actions: [],
      subscriptions: [subscriptionName],
      subject: "subject-1",
    },
    subject: "subject-1",
    diagnostics: {
      actions: [],
      granted: [],
      dropped: [],
      subscriptions: [subscriptionName],
      grantedSubscriptions: [subscriptionName],
      droppedSubscriptions: [],
    },
  }

  await primary.set(record)
  assertEqual(await peer.get(surfaceId), record, "set records must be visible to peer instances")

  const request = {
    surfaceId,
    callId: `${namespace}-concurrent`,
    fingerprint: "records.change\n{}",
    windowMs: 60_000,
  }
  let operations = 0
  let release: (() => void) | undefined
  let markStarted: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const operation = async (): Promise<ActionResult> => {
    operations += 1
    markStarted?.()
    await gate
    return { ok: true, value: { execution: operations } }
  }

  const first = runIdempotent(primary, request, operation)
  await started
  const duplicate = runIdempotent(peer, request, operation)
  release?.()
  const concurrentResults = await Promise.all([first, duplicate])
  assertEqual(operations, 1, "concurrent duplicates must execute once")
  assertEqual(
    concurrentResults,
    [
      { status: "result", result: { ok: true, value: { execution: 1 } } },
      { status: "result", result: { ok: true, value: { execution: 1 } } },
    ],
    "concurrent duplicates must receive the same result",
  )

  const replay = await runIdempotent(peer, request, async () => {
    operations += 1
    return { ok: true, value: { execution: operations } }
  })
  assertEqual(replay, concurrentResults[0], "completed results must replay within the window")
  assertEqual(operations, 1, "completed replays must not execute again")

  let conflictingOperations = 0
  const conflict = await runIdempotent(
    peer,
    { ...request, fingerprint: 'records.change\n{"different":true}' },
    async () => {
      conflictingOperations += 1
      return { ok: true, value: null }
    },
  )
  assertEqual(conflict, { status: "conflict" }, "fingerprint mismatches must conflict")
  assertEqual(conflictingOperations, 0, "fingerprint conflicts must not execute")

  const approvalRequest = { ...request, callId: `${namespace}-approval` }
  let approvals = 0
  const requireApproval = async (): Promise<ActionResult> => {
    approvals += 1
    return {
      ok: false,
      error: { code: "approval_required", message: "Approve this operation." },
    }
  }
  const approvalResults = [
    await runIdempotent(primary, approvalRequest, requireApproval),
    await runIdempotent(peer, approvalRequest, requireApproval),
  ]
  assertEqual(approvals, 2, "approval_required results must not be retained")
  assertEqual(
    approvalResults,
    [
      {
        status: "result",
        result: {
          ok: false,
          error: { code: "approval_required", message: "Approve this operation." },
        },
      },
      {
        status: "result",
        result: {
          ok: false,
          error: { code: "approval_required", message: "Approve this operation." },
        },
      },
    ],
    "approval_required callers must receive the provisional result",
  )

  const revokedRequest = { ...request, callId: `${namespace}-revoked` }
  let revokedOperations = 0
  const afterRevocation = async (): Promise<ActionResult> => ({
    ok: true,
    value: { execution: ++revokedOperations },
  })
  await runIdempotent(primary, revokedRequest, afterRevocation)
  await peer.revoke(surfaceId)
  assertEqual(await primary.get(surfaceId), undefined, "revoke must remove the surface record")
  await primary.set(record)
  await runIdempotent(primary, revokedRequest, afterRevocation)
  assertEqual(revokedOperations, 2, "revoke must remove completed idempotency entries")
  await peer.revoke(surfaceId)
}
