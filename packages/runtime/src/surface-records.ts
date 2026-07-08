import {
  genuiDialect,
  type CapabilityDescriptor,
  type Grant,
  type Surface,
  type SurfaceRecord,
  type SurfaceSource,
  type SurfaceStore,
} from "./types.js"

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

const copyCapabilities = (
  capabilities: readonly CapabilityDescriptor[],
): readonly CapabilityDescriptor[] =>
  Object.freeze(capabilities.map((capability) => Object.freeze({ ...capability })))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined =>
  meta === undefined ? undefined : Object.freeze({ ...meta })

export const copySource = (source: SurfaceSource): SurfaceSource => {
  const meta = copyMeta(source.meta)
  return Object.freeze(
    meta === undefined
      ? { html: source.html, requested: Object.freeze([...source.requested]) }
      : { html: source.html, requested: Object.freeze([...source.requested]), meta },
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

export const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    html: surface.html,
    capabilities: surface.grant.capabilities,
    meta: surface.meta,
  })

export const copySurfaceRecord = (record: SurfaceRecord): SurfaceRecord =>
  Object.freeze({
    surface: copySurface(record.surface),
    source: copySource(record.source),
  })

export const createSurfaceRecord = (input: CreateSurfaceRecordInput): SurfaceRecord => {
  const source = copySource(input.source)
  const surface = createSurfaceValue({
    id: createSurfaceId(),
    html: input.html,
    capabilities: input.capabilities,
    meta: source.meta,
  })

  return Object.freeze({ surface, source })
}

export const replaceSurfaceRecord = (input: ReplaceSurfaceRecordInput): SurfaceRecord =>
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
