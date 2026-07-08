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

/** Owns generated surface identity, grant construction, and in-memory record lookup. */
export const createSurfaceRecords = (): SurfaceRecords => {
  const surfaces = new Map<string, Surface>()
  let nextSurfaceId = 1

  const create = (input: CreateSurfaceRecordInput): Surface => {
    const id = `surface-${nextSurfaceId}`
    nextSurfaceId += 1

    const grant: Grant = { surfaceId: id, capabilities: input.capabilities }
    const surface: Surface =
      input.meta === undefined
        ? { id, html: input.html, grant, dialect: genuiDialect }
        : { id, html: input.html, grant, dialect: genuiDialect, meta: input.meta }

    surfaces.set(surface.id, surface)
    return surface
  }

  return {
    create,
    get: (id) => surfaces.get(id),
  }
}
