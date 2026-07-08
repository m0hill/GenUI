import {
  capabilityPolicy,
  findGrantedCapability,
  projectGrantedCapabilities,
  publicCapabilityDescriptors,
} from "./capability-projections.js"
import { genui0Instructions } from "./dialect/genui0.js"
import { isGenui0CapabilityName } from "./dialect/genui0-language.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import { parseWithSchema } from "./schema.js"
import { createSurfaceRecords } from "./surface-records.js"
import {
  type AnyCapabilityDefinition,
  type CapabilityCall,
  type CapabilityDefinition,
  type CapabilityDescriptor,
  type CapabilityErrorCode,
  type CapabilityResult,
  type CreateSurfaceInput,
  type ExecuteOptions,
  type Registry,
  type Surface,
} from "./types.js"

export interface CreateRegistryOptions<Ctx> {
  readonly capabilities: readonly AnyCapabilityDefinition<Ctx>[]
}

const capabilityError = (code: CapabilityErrorCode, message: string): CapabilityResult => ({
  ok: false,
  error: { code, message },
})

/** Preserve a capability definition's input and output types at declaration sites. */
export const defineCapability = <Ctx, Input, Output>(
  definition: CapabilityDefinition<Ctx, Input, Output>,
): CapabilityDefinition<Ctx, Input, Output> => definition

/** Create an isolated registry that owns capability definitions and per-surface grants. */
export const createRegistry = <Ctx>(options: CreateRegistryOptions<Ctx>): Registry<Ctx> => {
  const byName = new Map<string, AnyCapabilityDefinition<Ctx>>()
  const surfaceRecords = createSurfaceRecords()

  for (const capability of options.capabilities) {
    if (!isGenui0CapabilityName(capability.name)) {
      throw new Error(`Invalid capability name: ${capability.name}`)
    }
    if (byName.has(capability.name)) {
      throw new Error(`Duplicate capability name: ${capability.name}`)
    }
    byName.set(capability.name, capability)
  }

  const createSurface = (input: CreateSurfaceInput): Surface => {
    const grantProjection = projectGrantedCapabilities({ requested: input.requested, byName })
    const html = sanitizeSurfaceHtml(input.html, grantProjection.names)
    return surfaceRecords.create({
      html,
      capabilities: grantProjection.capabilities,
      source: input,
    })
  }

  const execute = async (
    call: CapabilityCall,
    ctx: Ctx,
    options?: ExecuteOptions,
  ): Promise<CapabilityResult> => {
    const record = surfaceRecords.get(call.surfaceId)
    if (record === undefined) {
      return capabilityError("unknown_surface", "Surface is not available.")
    }

    const capability = byName.get(call.capability)
    if (capability !== undefined && capabilityPolicy(capability) === "block") {
      return capabilityError("blocked", "Capability is blocked.")
    }

    const descriptor = findGrantedCapability(record.surface.grant, call.capability)
    if (descriptor === undefined || capability === undefined) {
      return capabilityError("not_granted", "Capability is not granted to this surface.")
    }

    if (capabilityPolicy(capability) === "require_approval") {
      const approved = await options?.approve?.(descriptor, call)
      if (approved !== true) return capabilityError("approval_denied", "Capability was denied.")
    }

    const input = await parseWithSchema(capability.input, call.input)
    if (!input.ok) return capabilityError("invalid_input", input.message)

    try {
      const value = await capability.execute(ctx, input.value)
      if (capability.output === undefined) return { ok: true, value }

      const output = await parseWithSchema(capability.output, value)
      if (!output.ok)
        return capabilityError("invalid_output", "Capability returned invalid output.")
      return { ok: true, value: output.value }
    } catch {
      return capabilityError("execution_failed", "Capability failed.")
    }
  }

  const descriptors = (): CapabilityDescriptor[] => publicCapabilityDescriptors(byName.values())

  const instructions = (): string => {
    return genui0Instructions(descriptors())
  }

  return { createSurface, execute, descriptors, instructions }
}
