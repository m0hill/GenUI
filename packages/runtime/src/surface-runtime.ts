import { projectGrantedActions } from "./action-projections.js"
import { codeSurfaceDialect } from "./code/surface.js"
import type { CoreDialect } from "./dialect-contract.js"
import { genui0SurfaceDialect } from "./dialect/genui0-surface.js"
import {
  codeDialect,
  genuiDialect,
  type Action,
  type AnyActionDefinition,
  type Dialect,
  type DroppedAction,
  type SanitizationDrop,
  type Grant,
  type Surface,
  type SurfaceInput,
  type SurfaceProjectionDiagnostics,
  type SurfaceRecord,
  type SurfaceStore,
} from "./types.js"

interface ProjectedSurfaceInput {
  readonly dialect: CoreDialect
  readonly content: string
  readonly actions: readonly Action[]
  readonly diagnostics: SurfaceProjectionDiagnostics
}

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly store?: SurfaceStore
}

interface CreateSurfaceRecordInput {
  readonly dialect: Dialect
  readonly content: string
  readonly actions: readonly Action[]
  readonly source: SurfaceInput
  readonly diagnostics: SurfaceProjectionDiagnostics
}

interface ReplaceSurfaceRecordInput {
  readonly record: SurfaceRecord
  readonly dialect: Dialect
  readonly content: string
  readonly actions: readonly Action[]
  readonly diagnostics: SurfaceProjectionDiagnostics
}

type MaybeLegacySurfaceRecord = Omit<SurfaceRecord, "diagnostics"> & {
  readonly diagnostics?: SurfaceProjectionDiagnostics
}

interface CreateSurfaceValueInput {
  readonly id: string
  readonly dialect: Dialect
  readonly content: string
  readonly actions: readonly Action[]
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface SurfaceRuntime {
  surface(input: SurfaceInput): Promise<Surface>
  reprojectSurface(id: string): Promise<Surface | undefined>
  getRecord(id: string): Promise<SurfaceRecord | undefined>
  diagnostics(id: string): Promise<SurfaceProjectionDiagnostics | undefined>
  instructions(actions: readonly Action[], dialect: Dialect): string
}

const copyDropped = (dropped: readonly DroppedAction[]): readonly DroppedAction[] =>
  Object.freeze(dropped.map((item) => Object.freeze({ ...item })))

const copySanitizationDropped = (
  dropped: readonly SanitizationDrop[],
): readonly SanitizationDrop[] => Object.freeze(dropped.map((item) => Object.freeze({ ...item })))

const copyDiagnostics = (diagnostics: SurfaceProjectionDiagnostics): SurfaceProjectionDiagnostics =>
  Object.freeze({
    actions: Object.freeze([...diagnostics.actions]),
    granted: Object.freeze([...diagnostics.granted]),
    dropped: copyDropped(diagnostics.dropped),
    html: Object.freeze({ dropped: copySanitizationDropped(diagnostics.html.dropped) }),
  })

const diagnosticsFor = (
  source: SurfaceInput,
  actions: readonly Action[],
  dropped: readonly DroppedAction[],
  htmlDropped: readonly SanitizationDrop[],
): SurfaceProjectionDiagnostics =>
  Object.freeze({
    actions: Object.freeze([...source.actions]),
    granted: Object.freeze(actions.map((action) => action.name)),
    dropped: copyDropped(dropped),
    html: Object.freeze({ dropped: copySanitizationDropped(htmlDropped) }),
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
  return Object.freeze({
    content: source.content,
    actions,
    ...(source.dialect === undefined ? {} : { dialect: source.dialect }),
    ...(meta === undefined ? {} : { meta }),
  })
}

const createSurfaceValue = (input: CreateSurfaceValueInput): Surface => {
  const grant: Grant = Object.freeze({
    surfaceId: input.id,
    actions: copyActions(input.actions),
  })
  const meta = copyMeta(input.meta)

  return Object.freeze(
    meta === undefined
      ? { id: input.id, content: input.content, grant, dialect: input.dialect }
      : { id: input.id, content: input.content, grant, dialect: input.dialect, meta },
  )
}

const createSurfaceId = (): string => globalThis.crypto.randomUUID()

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    dialect: surface.dialect,
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

const createSurfaceRecord = (input: CreateSurfaceRecordInput): SurfaceRecord => {
  const source = copySurfaceInput(input.source)
  const surface = createSurfaceValue({
    id: createSurfaceId(),
    dialect: input.dialect,
    content: input.content,
    actions: input.actions,
    meta: source.meta,
  })

  return Object.freeze({
    surface,
    source,
    diagnostics: copyDiagnostics(input.diagnostics),
  })
}

const replaceSurfaceRecord = (input: ReplaceSurfaceRecordInput): SurfaceRecord =>
  Object.freeze({
    surface: createSurfaceValue({
      id: input.record.surface.id,
      dialect: input.dialect,
      content: input.content,
      actions: input.actions,
      meta: input.record.source.meta,
    }),
    source: input.record.source,
    diagnostics: copyDiagnostics(input.diagnostics),
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
  const resolveDialect = (id: Dialect): CoreDialect => {
    if (id === codeDialect) return codeSurfaceDialect
    if (id === genuiDialect) return genui0SurfaceDialect
    throw new Error(`Unsupported generated UI dialect: ${id}`)
  }

  const project = (source: SurfaceInput): ProjectedSurfaceInput => {
    const dialect = resolveDialect(source.dialect ?? genuiDialect)
    const grantProjection = projectGrantedActions({ actions: source.actions, byName })
    const sanitized = dialect.project(source.content, grantProjection.actions)
    return {
      dialect,
      content: sanitized.html,
      actions: grantProjection.actions,
      diagnostics: diagnosticsFor(
        source,
        grantProjection.actions,
        grantProjection.dropped,
        sanitized.dropped,
      ),
    }
  }

  const normalizeStoredRecord = async (record: SurfaceRecord): Promise<SurfaceRecord> => {
    const stored = record as MaybeLegacySurfaceRecord
    if (stored.diagnostics !== undefined) return copySurfaceRecord(record)

    const projected = project(stored.source)
    const normalized = Object.freeze({
      surface: copySurface(stored.surface),
      source: copySurfaceInput(stored.source),
      diagnostics: copyDiagnostics(projected.diagnostics),
    })

    try {
      await store.set(normalized)
    } catch {
      // Backfilling diagnostics is compatibility-only. A readable legacy record should
      // still execute even if the store cannot persist the upgraded shape.
    }

    return normalized
  }

  const storedRecord = async (id: string): Promise<SurfaceRecord | undefined> => {
    const record = await store.get(id)
    return record === undefined ? undefined : normalizeStoredRecord(record)
  }

  const surface = async (input: SurfaceInput): Promise<Surface> => {
    const projected = project(input)
    const record = createSurfaceRecord({
      dialect: projected.dialect.id,
      content: projected.content,
      actions: projected.actions,
      source: input,
      diagnostics: projected.diagnostics,
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
      dialect: projected.dialect.id,
      content: projected.content,
      actions: projected.actions,
      diagnostics: projected.diagnostics,
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
    instructions: (actions, dialect) => resolveDialect(dialect).instructions(actions),
  }
}
