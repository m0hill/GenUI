import {
  projectGrantedCapabilities,
  type DroppedCapabilityRequest,
} from "./capability-projections.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import { createSurfaceRecords, type SurfaceRecord, type SurfaceSource } from "./surface-records.js"
import {
  type AnyCapabilityDefinition,
  type CapabilityDescriptor,
  type CreateSurfaceInput,
  type Surface,
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
}

export interface SurfaceRuntime {
  createSurface(input: CreateSurfaceInput): Surface
  reprojectSurface(id: string): Surface | undefined
  getRecord(id: string): SurfaceRecord | undefined
  diagnostics(id: string): SurfaceProjectionDiagnostics | undefined
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
}: CreateSurfaceRuntimeOptions<Ctx>): SurfaceRuntime => {
  const records = createSurfaceRecords()
  const diagnosticsBySurfaceId = new Map<string, SurfaceProjectionDiagnostics>()

  const project = (source: SurfaceSource): ProjectedSurfaceSource => {
    const grantProjection = projectGrantedCapabilities({ requested: source.requested, byName })
    return {
      html: sanitizeSurfaceHtml(source.html, grantProjection.names),
      capabilities: grantProjection.capabilities,
      diagnostics: diagnosticsFor(source, grantProjection.capabilities, grantProjection.dropped),
    }
  }

  const createSurface = (input: CreateSurfaceInput): Surface => {
    const projected = project(input)
    const surface = records.create({
      html: projected.html,
      capabilities: projected.capabilities,
      source: input,
    })
    diagnosticsBySurfaceId.set(surface.id, projected.diagnostics)
    return surface
  }

  const reprojectSurface = (id: string): Surface | undefined => {
    const record = records.get(id)
    if (record === undefined) return undefined

    const projected = project(record.source)
    const surface = records.replace({
      id,
      html: projected.html,
      capabilities: projected.capabilities,
    })
    if (surface !== undefined) diagnosticsBySurfaceId.set(id, projected.diagnostics)
    return surface
  }

  return {
    createSurface,
    reprojectSurface,
    getRecord: (id) => records.get(id),
    diagnostics: (id) => diagnosticsBySurfaceId.get(id),
  }
}
