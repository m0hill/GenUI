import { projectGrantedActions } from "./action-projections.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import {
  type Action,
  type AnyActionDefinition,
  type DroppedAction,
  genuiDialect,
  type Grant,
  type Surface,
  type SurfaceInput,
  type SurfaceProjectionDiagnostics,
  type SurfaceRecord,
  type SurfaceStore,
} from "./types.js"

interface ProjectedSurfaceInput {
  readonly html: string
  readonly actions: readonly Action[]
  readonly diagnostics: SurfaceProjectionDiagnostics
}

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly store?: SurfaceStore
}

interface CreateSurfaceRecordInput {
  readonly html: string
  readonly actions: readonly Action[]
  readonly source: SurfaceInput
}

interface ReplaceSurfaceRecordInput {
  readonly record: SurfaceRecord
  readonly html: string
  readonly actions: readonly Action[]
}

interface CreateSurfaceValueInput {
  readonly id: string
  readonly html: string
  readonly actions: readonly Action[]
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface SurfaceRuntime {
  surface(input: SurfaceInput): Promise<Surface>
  reprojectSurface(id: string): Promise<Surface | undefined>
  getRecord(id: string): Promise<SurfaceRecord | undefined>
  diagnostics(id: string): Promise<SurfaceProjectionDiagnostics | undefined>
}

const copyDropped = (dropped: readonly DroppedAction[]): readonly DroppedAction[] =>
  Object.freeze(dropped.map((item) => Object.freeze({ ...item })))

const diagnosticsFor = (
  source: SurfaceInput,
  actions: readonly Action[],
  dropped: readonly DroppedAction[],
): SurfaceProjectionDiagnostics =>
  Object.freeze({
    actions: Object.freeze([...source.actions]),
    granted: Object.freeze(actions.map((action) => action.name)),
    dropped: copyDropped(dropped),
  })

const copyActions = (actions: readonly Action[]): readonly Action[] =>
  Object.freeze(actions.map((action) => Object.freeze({ ...action })))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined =>
  meta === undefined ? undefined : Object.freeze({ ...meta })

const copySurfaceInput = (source: SurfaceInput): SurfaceInput => {
  const actions = Object.freeze([...source.actions])
  const meta = copyMeta(source.meta)
  return Object.freeze(
    meta === undefined ? { html: source.html, actions } : { html: source.html, actions, meta },
  )
}

const createSurfaceValue = (input: CreateSurfaceValueInput): Surface => {
  const grant: Grant = Object.freeze({
    surfaceId: input.id,
    actions: copyActions(input.actions),
  })
  const meta = copyMeta(input.meta)

  return Object.freeze(
    meta === undefined
      ? { id: input.id, html: input.html, grant, dialect: genuiDialect }
      : { id: input.id, html: input.html, grant, dialect: genuiDialect, meta },
  )
}

const createSurfaceId = (): string => globalThis.crypto.randomUUID()

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    html: surface.html,
    actions: surface.grant.actions,
    meta: surface.meta,
  })

const copySurfaceRecord = (record: SurfaceRecord): SurfaceRecord =>
  Object.freeze({
    surface: copySurface(record.surface),
    source: copySurfaceInput(record.source),
  })

const createSurfaceRecord = (input: CreateSurfaceRecordInput): SurfaceRecord => {
  const source = copySurfaceInput(input.source)
  const surface = createSurfaceValue({
    id: createSurfaceId(),
    html: input.html,
    actions: input.actions,
    meta: source.meta,
  })

  return Object.freeze({ surface, source })
}

const replaceSurfaceRecord = (input: ReplaceSurfaceRecordInput): SurfaceRecord =>
  Object.freeze({
    surface: createSurfaceValue({
      id: input.record.surface.id,
      html: input.html,
      actions: input.actions,
      meta: input.record.source.meta,
    }),
    source: input.record.source,
  })

/** Create the default in-memory generated surface store. */
export const memoryStore = (): SurfaceStore => {
  const records = new Map<string, SurfaceRecord>()

  return {
    get: (id) => {
      const record = records.get(id)
      return record === undefined ? undefined : copySurfaceRecord(record)
    },
    set: (record) => {
      records.set(record.surface.id, copySurfaceRecord(record))
    },
  }
}

/** Owns source projection, sanitization, diagnostics, and surface record lifecycle. */
export const createSurfaceRuntime = <Ctx>({
  byName,
  store = memoryStore(),
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const project = (source: SurfaceInput): ProjectedSurfaceInput => {
    const grantProjection = projectGrantedActions({ actions: source.actions, byName })
    return {
      html: sanitizeSurfaceHtml(source.html, grantProjection.names),
      actions: grantProjection.actions,
      diagnostics: diagnosticsFor(source, grantProjection.actions, grantProjection.dropped),
    }
  }

  const storedRecord = async (id: string): Promise<SurfaceRecord | undefined> => {
    const record = await store.get(id)
    return record === undefined ? undefined : copySurfaceRecord(record)
  }

  const surface = async (input: SurfaceInput): Promise<Surface> => {
    const projected = project(input)
    const record = createSurfaceRecord({
      html: projected.html,
      actions: projected.actions,
      source: input,
    })
    await store.set(record)
    const surface = copySurface(record.surface)
    return surface
  }

  const reprojectSurface = async (id: string): Promise<Surface | undefined> => {
    const record = await storedRecord(id)
    if (record === undefined) return undefined

    const projected = project(record.source)
    const nextRecord = replaceSurfaceRecord({
      record,
      html: projected.html,
      actions: projected.actions,
    })
    await store.set(nextRecord)
    return copySurface(nextRecord.surface)
  }

  const diagnostics = async (id: string): Promise<SurfaceProjectionDiagnostics | undefined> => {
    const record = await storedRecord(id)
    if (record === undefined) return undefined

    const projected = project(record.source)
    return projected.diagnostics
  }

  return {
    surface,
    reprojectSurface,
    getRecord: storedRecord,
    diagnostics,
  }
}
