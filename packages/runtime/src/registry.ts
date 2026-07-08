import {
  capabilityPolicy,
  findGrantedCapability,
  publicCapabilityDescriptors,
} from "./capability-projections.js"
import { capabilityError } from "./capability-result.js"
import { genui0Dialect } from "./dialect/genui0.js"
import { genui0Language } from "./dialect/genui0-language.js"
import { parseWithSchema } from "./schema.js"
import { createSurfaceRuntime } from "./surface-runtime.js"
import {
  type AnyCapabilityDefinition,
  type CapabilityCall,
  type CapabilityDefinition,
  type CapabilityDescriptor,
  type CapabilityResult,
  type CreateSurfaceInput,
  type ExecuteOptions,
  type Registry,
  type Surface,
  type SurfaceStore,
} from "./types.js"

export interface CreateRegistryOptions<Ctx> {
  readonly capabilities: readonly AnyCapabilityDefinition<Ctx>[]
  readonly surfaces?: SurfaceStore
}

/** Preserve a capability definition's input and output types at declaration sites. */
export const defineCapability = <Ctx, Input, Output>(
  definition: CapabilityDefinition<Ctx, Input, Output>,
): CapabilityDefinition<Ctx, Input, Output> => definition

/** Create an isolated registry that owns capability definitions and per-surface grants. */
export const createRegistry = <Ctx>(options: CreateRegistryOptions<Ctx>): Registry<Ctx> => {
  const byName = new Map<string, AnyCapabilityDefinition<Ctx>>()

  for (const capability of options.capabilities) {
    if (!genui0Language.isCapabilityName(capability.name)) {
      throw new Error(`Invalid capability name: ${capability.name}`)
    }
    if (byName.has(capability.name)) {
      throw new Error(`Duplicate capability name: ${capability.name}`)
    }
    byName.set(capability.name, capability)
  }

  const surfaceRuntime = createSurfaceRuntime({ byName, store: options.surfaces })

  const createSurface = (input: CreateSurfaceInput): Promise<Surface> =>
    surfaceRuntime.createSurface(input)

  const execute = async (
    call: CapabilityCall,
    ctx: Ctx,
    options?: ExecuteOptions,
  ): Promise<CapabilityResult> => {
    let record: Awaited<ReturnType<typeof surfaceRuntime.getRecord>>
    try {
      record = await surfaceRuntime.getRecord(call.surfaceId)
    } catch {
      return capabilityError("storage_unavailable", "Surface store is unavailable.")
    }

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
    return genui0Dialect.instructions(descriptors())
  }

  return { createSurface, execute, descriptors, instructions }
}
