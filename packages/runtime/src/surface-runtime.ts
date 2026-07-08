import { projectGrantedCapabilities } from "./capability-projections.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import {
  genuiDialect,
  type AnyCapabilityDefinition,
  type CapabilityDescriptor,
  type CreateSurfaceInput,
  type DroppedCapabilityRequest,
  type Grant,
  type Surface,
  type SurfaceProjectionDiagnostics,
  type SurfaceRecord,
  type SurfaceSource,
  type SurfaceStore,
} from "./types.js"

interface ProjectedSurfaceSource {
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly diagnostics: SurfaceProjectionDiagnostics
}

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyCapabilityDefinition<Ctx>>
  readonly store?: SurfaceStore
}

interface CreateSurfaceRecordInput {
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly source: SurfaceSource
}

interface ReplaceSurfaceRecordInput {
  readonly record: SurfaceRecord
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
}

interface CreateSurfaceValueInput {
  readonly id: string
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface SurfaceRuntime {
  createSurface(input: CreateSurfaceInput): Promise<Surface>
  reprojectSurface(id: string): Promise<Surface | undefined>
  getRecord(id: string): Promise<SurfaceRecord | undefined>
  diagnostics(id: string): Promise<SurfaceProjectionDiagnostics | undefined>
}

const copyDropped = (
  dropped: readonly DroppedCapabilityRequest[],
): readonly DroppedCapabilityRequest[] =>
  Object.freeze(dropped.map((item) => Object.freeze({ ...item })))

const diagnosticsFor = (
  source: SurfaceSource,
  capabilities: readonly CapabilityDescriptor[],
  dropped: readonly DroppedCapabilityRequest[],
): SurfaceProjectionDiagnostics =>
  Object.freeze({
    requested: Object.freeze([...source.requested]),
    granted: Object.freeze(capabilities.map((capability) => capability.name)),
    dropped: copyDropped(dropped),
  })

const copyCapabilities = (
  capabilities: readonly CapabilityDescriptor[],
): readonly CapabilityDescriptor[] =>
  Object.freeze(capabilities.map((capability) => Object.freeze({ ...capability })))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined =>
  meta === undefined ? undefined : Object.freeze({ ...meta })

const copySurfaceSource = (source: SurfaceSource): SurfaceSource => {
  const requested = Object.freeze([...source.requested])
  const meta = copyMeta(source.meta)
  return Object.freeze(
    meta === undefined ? { html: source.html, requested } : { html: source.html, requested, meta },
  )
}

const createSurfaceValue = (input: CreateSurfaceValueInput): Surface => {
  const grant: Grant = Object.freeze({
    surfaceId: input.id,
    capabilities: copyCapabilities(input.capabilities),
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
    capabilities: surface.grant.capabilities,
    meta: surface.meta,
  })

const copySurfaceRecord = (record: SurfaceRecord): SurfaceRecord =>
  Object.freeze({
    surface: copySurface(record.surface),
    source: copySurfaceSource(record.source),
  })

const createSurfaceRecord = (input: CreateSurfaceRecordInput): SurfaceRecord => {
  const source = copySurfaceSource(input.source)
  const surface = createSurfaceValue({
    id: createSurfaceId(),
    html: input.html,
    capabilities: input.capabilities,
    meta: source.meta,
  })

  return Object.freeze({ surface, source })
}

const replaceSurfaceRecord = (input: ReplaceSurfaceRecordInput): SurfaceRecord =>
  Object.freeze({
    surface: createSurfaceValue({
      id: input.record.surface.id,
      html: input.html,
      capabilities: input.capabilities,
      meta: input.record.source.meta,
    }),
    source: input.record.source,
  })

/** Create the default in-memory generated surface store. */
export const createMemorySurfaceStore = (): SurfaceStore => {
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
  store = createMemorySurfaceStore(),
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const project = (source: SurfaceSource): ProjectedSurfaceSource => {
    const grantProjection = projectGrantedCapabilities({ requested: source.requested, byName })
    return {
      html: sanitizeSurfaceHtml(source.html, grantProjection.names),
      capabilities: grantProjection.capabilities,
      diagnostics: diagnosticsFor(source, grantProjection.capabilities, grantProjection.dropped),
    }
  }

  const storedRecord = async (id: string): Promise<SurfaceRecord | undefined> => {
    const record = await store.get(id)
    return record === undefined ? undefined : copySurfaceRecord(record)
  }

  const createSurface = async (input: CreateSurfaceInput): Promise<Surface> => {
    const projected = project(input)
    const record = createSurfaceRecord({
      html: projected.html,
      capabilities: projected.capabilities,
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
      capabilities: projected.capabilities,
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
    createSurface,
    reprojectSurface,
    getRecord: storedRecord,
    diagnostics,
  }
}
