import {
  projectGrantedCapabilities,
  type DroppedCapabilityRequest,
} from "./capability-projections.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import {
  copySurface,
  copySurfaceRecord,
  createMemorySurfaceStore,
  createSurfaceRecord,
  replaceSurfaceRecord,
} from "./surface-records.js"
import {
  type AnyCapabilityDefinition,
  type CapabilityDescriptor,
  type CreateSurfaceInput,
  type Surface,
  type SurfaceRecord,
  type SurfaceSource,
  type SurfaceStore,
} from "./types.js"

export interface SurfaceProjectionDiagnostics {
  readonly requested: readonly string[]
  readonly granted: readonly string[]
  readonly dropped: readonly DroppedCapabilityRequest[]
}

interface ProjectedSurfaceSource {
  readonly html: string
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly diagnostics: SurfaceProjectionDiagnostics
}

interface CreateSurfaceRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, AnyCapabilityDefinition<Ctx>>
  readonly store?: SurfaceStore
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

/** Owns source projection, sanitization, diagnostics, and surface record lifecycle. */
export const createSurfaceRuntime = <Ctx>({
  byName,
  store = createMemorySurfaceStore(),
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const diagnosticsBySurfaceId = new Map<string, SurfaceProjectionDiagnostics>()

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
    diagnosticsBySurfaceId.set(surface.id, projected.diagnostics)
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
    diagnosticsBySurfaceId.set(id, projected.diagnostics)
    return copySurface(nextRecord.surface)
  }

  const diagnostics = async (id: string): Promise<SurfaceProjectionDiagnostics | undefined> => {
    const cached = diagnosticsBySurfaceId.get(id)
    if (cached !== undefined) return cached

    const record = await storedRecord(id)
    if (record === undefined) return undefined

    const projected = project(record.source)
    diagnosticsBySurfaceId.set(id, projected.diagnostics)
    return projected.diagnostics
  }

  return {
    createSurface,
    reprojectSurface,
    getRecord: storedRecord,
    diagnostics,
  }
}
