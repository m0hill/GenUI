import {
  codeDialect,
  type Action,
  type ActionResult,
  type DroppedAction,
  type DroppedSubscription,
  type Grant,
  type Subscription,
  type Surface,
  type SurfaceInput,
  type SurfaceProjectionDiagnostics,
  type SurfaceRecord,
} from "./protocol/index.js"
import { projectGrantedActions } from "./action-projections.js"
import { codeInstructions } from "./code/instructions.js"
import { projectGrantedSubscriptions } from "./subscription-projections.js"
import type {
  AnyActionDefinition,
  AnySubscriptionDefinition,
  IdempotencyRequest,
  IdempotencyResult,
  SurfaceStore,
} from "./types.js"

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly subscriptionsByName?: ReadonlyMap<string, AnySubscriptionDefinition<Ctx>>
  readonly store?: SurfaceStore
}

interface SurfaceValueInput {
  readonly id: string
  readonly content: string
  readonly actions: readonly Action[]
  readonly subscriptions: readonly Subscription[]
  readonly subject?: string
  readonly expiresAt?: number
  readonly meta?: Readonly<Record<string, unknown>>
}

interface MemoryIdempotencyEntry {
  readonly fingerprint: string
  expiresAt: number | undefined
  readonly result: Promise<ActionResult>
}

export interface SurfaceRuntime {
  surface(input: SurfaceInput): Promise<Surface>
  reprojectSurface(id: string): Promise<Surface | undefined>
  revoke(id: string): Promise<void>
  getRecord(id: string): Promise<SurfaceRecord | undefined>
  diagnostics(id: string): Promise<SurfaceProjectionDiagnostics | undefined>
  instructions(actions: readonly Action[], subscriptions: readonly Subscription[]): string
  runIdempotent(
    request: IdempotencyRequest,
    operation: () => Promise<ActionResult>,
  ): Promise<IdempotencyResult>
}

const copyDropped = (dropped: readonly DroppedAction[]): readonly DroppedAction[] =>
  dropped.map((item) => ({ ...item }))

const copyDroppedSubscriptions = (
  dropped: readonly DroppedSubscription[],
): readonly DroppedSubscription[] => dropped.map((item) => ({ ...item }))

const copyDiagnostics = (
  diagnostics: SurfaceProjectionDiagnostics,
): SurfaceProjectionDiagnostics => ({
  actions: [...diagnostics.actions],
  granted: [...diagnostics.granted],
  dropped: copyDropped(diagnostics.dropped),
  subscriptions: [...diagnostics.subscriptions],
  grantedSubscriptions: [...diagnostics.grantedSubscriptions],
  droppedSubscriptions: copyDroppedSubscriptions(diagnostics.droppedSubscriptions),
})

const copyActions = (actions: readonly Action[]): readonly Action[] =>
  actions.map((action) => ({ ...action }))

const copySubscriptionSchema = (
  schema: Subscription["inputSchema"],
): Subscription["inputSchema"] => {
  if (schema === undefined) return undefined
  // SAFETY: JsonSchema is a JSON object by contract; the round trip severs caller references.
  return JSON.parse(JSON.stringify(schema)) as Subscription["inputSchema"]
}

const copySubscriptions = (subscriptions: readonly Subscription[]): readonly Subscription[] =>
  subscriptions.map((subscription) => ({
    ...subscription,
    ...(subscription.inputSchema === undefined
      ? {}
      : { inputSchema: copySubscriptionSchema(subscription.inputSchema) }),
    ...(subscription.eventSchema === undefined
      ? {}
      : { eventSchema: copySubscriptionSchema(subscription.eventSchema) }),
  }))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined => (meta === undefined ? undefined : { ...meta })

const copySurfaceInput = (source: SurfaceInput): SurfaceInput => {
  const meta = copyMeta(source.meta)
  return {
    content: source.content,
    actions: [...source.actions],
    ...(source.subscriptions === undefined ? {} : { subscriptions: [...source.subscriptions] }),
    ...(source.dialect === undefined ? {} : { dialect: source.dialect }),
    ...(source.subject === undefined ? {} : { subject: source.subject }),
    ...(source.ttlMs === undefined ? {} : { ttlMs: source.ttlMs }),
    ...(meta === undefined ? {} : { meta }),
  }
}

const createSurfaceValue = (input: SurfaceValueInput): Surface => {
  const grant: Grant = {
    surfaceId: input.id,
    actions: copyActions(input.actions),
    subscriptions: copySubscriptions(input.subscriptions),
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  }
  const meta = copyMeta(input.meta)
  return {
    id: input.id,
    content: input.content,
    grant,
    dialect: codeDialect,
    ...(meta === undefined ? {} : { meta }),
  }
}

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    content: surface.content,
    actions: surface.grant.actions,
    subscriptions: surface.grant.subscriptions,
    subject: surface.grant.subject,
    expiresAt: surface.grant.expiresAt,
    meta: surface.meta,
  })

const copySurfaceRecord = (record: SurfaceRecord): SurfaceRecord => ({
  surface: copySurface(record.surface),
  source: copySurfaceInput(record.source),
  ...(record.subject === undefined ? {} : { subject: record.subject }),
  diagnostics: copyDiagnostics(record.diagnostics),
})

const assertCodeSurface = (source: SurfaceInput): void => {
  if (source.dialect !== undefined && source.dialect !== codeDialect) {
    throw new Error(`Unsupported generated UI dialect: ${source.dialect}`)
  }
  if (source.ttlMs !== undefined && (!Number.isSafeInteger(source.ttlMs) || source.ttlMs < 0)) {
    throw new Error("Surface ttlMs must be a non-negative safe integer.")
  }
}

const grantExpiry = (source: SurfaceInput): number | undefined => {
  if (source.ttlMs === undefined) return undefined
  const expiresAt = Date.now() + source.ttlMs
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error("Surface ttlMs produces an invalid expiry.")
  }
  return expiresAt
}

/** Process-local store; authority and idempotency state are lost on restart. */
export const memoryStore = (): SurfaceStore => {
  const records = new Map<string, SurfaceRecord>()
  const idempotency = new Map<string, Map<string, MemoryIdempotencyEntry>>()

  return {
    get: (id) => {
      const record = records.get(id)
      return record === undefined ? undefined : copySurfaceRecord(record)
    },
    set: (record) => {
      records.set(record.surface.id, copySurfaceRecord(record))
    },
    revoke: (id) => {
      records.delete(id)
      idempotency.delete(id)
    },
    async runIdempotent(request, operation) {
      const now = Date.now()
      for (const [surfaceId, calls] of idempotency) {
        for (const [callId, entry] of calls) {
          if (entry.expiresAt !== undefined && entry.expiresAt <= now) calls.delete(callId)
        }
        if (calls.size === 0) idempotency.delete(surfaceId)
      }

      let calls = idempotency.get(request.surfaceId)
      if (calls === undefined) {
        calls = new Map()
        idempotency.set(request.surfaceId, calls)
      }
      const existing = calls.get(request.callId)
      if (existing !== undefined) {
        if (existing.fingerprint !== request.fingerprint) return { status: "conflict" }
        return { status: "result", result: await existing.result }
      }

      const result = Promise.resolve().then(operation)
      const entry: MemoryIdempotencyEntry = {
        fingerprint: request.fingerprint,
        expiresAt: undefined,
        result,
      }
      calls.set(request.callId, entry)
      try {
        const value = await result
        if (!value.ok && value.error.code === "approval_required") {
          if (calls.get(request.callId) === entry) calls.delete(request.callId)
          if (calls.size === 0) idempotency.delete(request.surfaceId)
        } else {
          entry.expiresAt = Date.now() + request.windowMs
        }
        return { status: "result", result: value }
      } catch (error) {
        if (calls.get(request.callId) === entry) calls.delete(request.callId)
        throw error
      }
    },
  }
}

export const createSurfaceRuntime = <Ctx>({
  byName,
  subscriptionsByName = new Map(),
  store = memoryStore(),
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const project = (source: SurfaceInput) => {
    assertCodeSurface(source)
    const actionGrant = projectGrantedActions({ actions: source.actions, byName })
    const subscriptionGrant = projectGrantedSubscriptions({
      subscriptions: source.subscriptions ?? [],
      byName: subscriptionsByName,
    })
    return {
      content: source.content,
      actions: actionGrant.actions,
      subscriptions: subscriptionGrant.subscriptions,
      diagnostics: {
        actions: [...source.actions],
        granted: actionGrant.actions.map((action) => action.name),
        dropped: copyDropped(actionGrant.dropped),
        subscriptions: [...(source.subscriptions ?? [])],
        grantedSubscriptions: subscriptionGrant.subscriptions.map(
          (subscription) => subscription.name,
        ),
        droppedSubscriptions: copyDroppedSubscriptions(subscriptionGrant.dropped),
      },
    }
  }

  const storedRecord = async (id: string): Promise<SurfaceRecord | undefined> => {
    const record = await store.get(id)
    return record === undefined ? undefined : copySurfaceRecord(record)
  }

  const surface = async (input: SurfaceInput): Promise<Surface> => {
    const source = copySurfaceInput(input)
    const projected = project(source)
    const surface = createSurfaceValue({
      id: globalThis.crypto.randomUUID(),
      content: projected.content,
      actions: projected.actions,
      subscriptions: projected.subscriptions,
      subject: source.subject,
      expiresAt: grantExpiry(source),
      meta: source.meta,
    })
    const record = {
      surface,
      source,
      ...(source.subject === undefined ? {} : { subject: source.subject }),
      diagnostics: copyDiagnostics(projected.diagnostics),
    }
    await store.set(record)
    return copySurface(surface)
  }

  const reprojectSurface = async (id: string): Promise<Surface | undefined> => {
    const record = await storedRecord(id)
    if (record === undefined) return undefined

    const projected = project(record.source)
    const surface = createSurfaceValue({
      id,
      content: projected.content,
      actions: projected.actions,
      subscriptions: projected.subscriptions,
      subject: record.subject,
      expiresAt: record.surface.grant.expiresAt,
      meta: record.source.meta,
    })
    const nextRecord = {
      surface,
      source: record.source,
      ...(record.subject === undefined ? {} : { subject: record.subject }),
      diagnostics: copyDiagnostics(projected.diagnostics),
    }
    await store.set(nextRecord)
    return copySurface(surface)
  }

  const diagnostics = async (id: string): Promise<SurfaceProjectionDiagnostics | undefined> => {
    const record = await storedRecord(id)
    if (record === undefined) return undefined
    return project(record.source).diagnostics
  }

  return {
    surface,
    reprojectSurface,
    revoke: async (id) => store.revoke(id),
    getRecord: storedRecord,
    diagnostics,
    instructions: (actions, subscriptions) => codeInstructions(actions, subscriptions),
    runIdempotent: async (request, operation) => store.runIdempotent(request, operation),
  }
}
