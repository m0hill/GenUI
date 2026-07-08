import { genuiDialect, type CapabilityDescriptor, type Grant, type Surface } from "./types.js"

export interface SurfaceSource {
  readonly html: string
  readonly requested: readonly string[]
  readonly meta?: Readonly<Record<string, unknown>>
}

interface CreateSurfaceRecordInput {
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly source: SurfaceSource
}

export interface SurfaceRecord {
  readonly surface: Surface
  readonly source: SurfaceSource
}

interface SurfaceRecords {
  create(input: CreateSurfaceRecordInput): Surface
  replace(input: ReplaceSurfaceRecordInput): Surface | undefined
  get(id: string): SurfaceRecord | undefined
}

interface ReplaceSurfaceRecordInput {
  readonly id: string
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

const copySource = (source: SurfaceSource): SurfaceSource => {
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

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    html: surface.html,
    capabilities: surface.grant.capabilities,
    meta: surface.meta,
  })

/** Owns generated surface identity, immutable public values, and in-memory record lookup. */
export const createSurfaceRecords = (): SurfaceRecords => {
  const records = new Map<string, SurfaceRecord>()

  const create = (input: CreateSurfaceRecordInput): Surface => {
    const source = copySource(input.source)
    const surface = createSurfaceValue({
      id: createSurfaceId(),
      html: input.html,
      capabilities: input.capabilities,
      meta: source.meta,
    })
    records.set(surface.id, Object.freeze({ surface, source }))
    return copySurface(surface)
  }

  const replace = (input: ReplaceSurfaceRecordInput): Surface | undefined => {
    const record = records.get(input.id)
    if (record === undefined) return undefined

    const surface = createSurfaceValue({
      id: input.id,
      html: input.html,
      capabilities: input.capabilities,
      meta: record.source.meta,
    })
    records.set(input.id, Object.freeze({ surface, source: record.source }))
    return copySurface(surface)
  }

  return {
    create,
    replace,
    get: (id) => records.get(id),
  }
}
