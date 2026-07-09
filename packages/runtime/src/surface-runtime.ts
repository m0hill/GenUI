import { projectGrantedActions } from "./action-projections.js"
import { codeInstructions } from "./code/instructions.js"
import {
  codeDialect,
  type Action,
  type ActionResult,
  type AnyActionDefinition,
  type DroppedAction,
  type Grant,
  type IdempotencyRequest,
  type IdempotencyResult,
  type Surface,
  type SurfaceInput,
  type SurfaceProjectionDiagnostics,
  type SurfaceRecord,
  type SurfaceStore,
} from "./types.js"

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly store?: SurfaceStore
}

interface SurfaceValueInput {
  readonly id: string
  readonly content: string
  readonly actions: readonly Action[]
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
  getRecord(id: string): Promise<SurfaceRecord | undefined>
  diagnostics(id: string): Promise<SurfaceProjectionDiagnostics | undefined>
  instructions(actions: readonly Action[]): string
  runIdempotent(
    request: IdempotencyRequest,
    operation: () => Promise<ActionResult>,
  ): Promise<IdempotencyResult>
}

const copyDropped = (dropped: readonly DroppedAction[]): readonly DroppedAction[] =>
  Object.freeze(dropped.map((item) => Object.freeze({ ...item })))

const copyDiagnostics = (diagnostics: SurfaceProjectionDiagnostics): SurfaceProjectionDiagnostics =>
  Object.freeze({
    actions: Object.freeze([...diagnostics.actions]),
    granted: Object.freeze([...diagnostics.granted]),
    dropped: copyDropped(diagnostics.dropped),
  })

const copyActions = (actions: readonly Action[]): readonly Action[] =>
  Object.freeze(actions.map((action) => Object.freeze({ ...action })))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined =>
  meta === undefined ? undefined : Object.freeze({ ...meta })

const copySurfaceInput = (source: SurfaceInput): SurfaceInput => {
  const meta = copyMeta(source.meta)
  return Object.freeze({
    content: source.content,
    actions: Object.freeze([...source.actions]),
    ...(source.dialect === undefined ? {} : { dialect: source.dialect }),
    ...(meta === undefined ? {} : { meta }),
  })
}

const createSurfaceValue = (input: SurfaceValueInput): Surface => {
  const grant: Grant = Object.freeze({
    surfaceId: input.id,
    actions: copyActions(input.actions),
  })
  const meta = copyMeta(input.meta)
  return Object.freeze({
    id: input.id,
    content: input.content,
    grant,
    dialect: codeDialect,
    ...(meta === undefined ? {} : { meta }),
  })
}

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    content: surface.content,
    actions: surface.grant.actions,
    meta: surface.meta,
  })

const copySurfaceRecord = (record: SurfaceRecord): SurfaceRecord =>
  Object.freeze({
    surface: copySurface(record.surface),
    source: copySurfaceInput(record.source),
    diagnostics: copyDiagnostics(record.diagnostics),
  })

const assertCodeSurface = (source: SurfaceInput): void => {
  if (source.dialect !== undefined && source.dialect !== codeDialect) {
    throw new Error(`Unsupported generated UI dialect: ${source.dialect}`)
  }
}

/** Create the default in-memory generated surface store. */
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
        entry.expiresAt = Date.now() + request.windowMs
        return { status: "result", result: value }
      } catch (error) {
        if (calls.get(request.callId) === entry) calls.delete(request.callId)
        throw error
      }
    },
  }
}

/** Owns code surface projection and authoritative record lifecycle. */
export const createSurfaceRuntime = <Ctx>({
  byName,
  store = memoryStore(),
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const project = (source: SurfaceInput) => {
    assertCodeSurface(source)
    const grant = projectGrantedActions({ actions: source.actions, byName })
    return {
      content: source.content,
      actions: grant.actions,
      diagnostics: Object.freeze({
        actions: Object.freeze([...source.actions]),
        granted: Object.freeze(grant.actions.map((action) => action.name)),
        dropped: copyDropped(grant.dropped),
      }),
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
      meta: source.meta,
    })
    const record = Object.freeze({
      surface,
      source,
      diagnostics: copyDiagnostics(projected.diagnostics),
    })
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
      meta: record.source.meta,
    })
    const nextRecord = Object.freeze({
      surface,
      source: record.source,
      diagnostics: copyDiagnostics(projected.diagnostics),
    })
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
    getRecord: storedRecord,
    diagnostics,
    instructions: codeInstructions,
    runIdempotent: async (request, operation) => store.runIdempotent(request, operation),
  }
}
