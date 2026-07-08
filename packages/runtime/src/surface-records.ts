import { genuiDialect, type CapabilityDescriptor, type Grant, type Surface } from "./types.js"

interface CreateSurfaceRecordInput {
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly meta?: Readonly<Record<string, unknown>>
}

interface SurfaceRecords {
  create(input: CreateSurfaceRecordInput): Surface
  get(id: string): Surface | undefined
}

interface CreateSurfaceValueInput extends CreateSurfaceRecordInput {
  readonly id: string
}

const copyCapabilities = (
  capabilities: readonly CapabilityDescriptor[],
): readonly CapabilityDescriptor[] =>
  Object.freeze(capabilities.map((capability) => Object.freeze({ ...capability })))

const copyMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined =>
  meta === undefined ? undefined : Object.freeze({ ...meta })

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

const copySurface = (surface: Surface): Surface =>
  createSurfaceValue({
    id: surface.id,
    html: surface.html,
    capabilities: surface.grant.capabilities,
    meta: surface.meta,
  })

/** Owns generated surface identity, grant construction, and in-memory record lookup. */
export const createSurfaceRecords = (): SurfaceRecords => {
  const surfaces = new Map<string, Surface>()
  let nextSurfaceId = 1

  const create = (input: CreateSurfaceRecordInput): Surface => {
    const id = `surface-${nextSurfaceId}`
    nextSurfaceId += 1

    const surface = createSurfaceValue({ id, ...input })
    surfaces.set(surface.id, surface)
    return copySurface(surface)
  }

  return {
    create,
    get: (id) => surfaces.get(id),
  }
}
