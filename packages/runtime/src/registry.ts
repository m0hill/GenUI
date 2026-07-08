import { genui0Instructions } from "./dialect/genui0.js"
import { sanitizeSurfaceHtml } from "./sanitizer.js"
import { parseWithSchema } from "./schema.js"
import {
  genuiDialect,
  type AnyCapabilityDefinition,
  type CapabilityCall,
  type CapabilityDefinition,
  type CapabilityDescriptor,
  type CapabilityErrorCode,
  type CapabilityResult,
  type CreateSurfaceInput,
  type ExecuteOptions,
  type Grant,
  type Policy,
  type Registry,
  type Surface,
} from "./types.js"

export interface CreateRegistryOptions<Ctx> {
  readonly capabilities: readonly AnyCapabilityDefinition<Ctx>[]
}

const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i

const capabilityPolicy = (definition: AnyCapabilityDefinition<unknown>): Policy =>
  definition.policy ?? "allow"

const descriptorFor = (definition: AnyCapabilityDefinition<unknown>): CapabilityDescriptor => ({
  name: definition.name,
  description: definition.description,
  effect: definition.effect,
  requiresApproval: capabilityPolicy(definition) === "require_approval",
})

const capabilityError = (code: CapabilityErrorCode, message: string): CapabilityResult => ({
  ok: false,
  error: { code, message },
})

const publicCapabilities = <Ctx>(
  capabilities: Iterable<AnyCapabilityDefinition<Ctx>>,
): CapabilityDescriptor[] => {
  const descriptors: CapabilityDescriptor[] = []
  for (const capability of capabilities) {
    if (capabilityPolicy(capability) !== "block") descriptors.push(descriptorFor(capability))
  }
  return descriptors
}

const grantedCapabilities = <Ctx>(
  requested: readonly string[],
  byName: ReadonlyMap<string, AnyCapabilityDefinition<Ctx>>,
): CapabilityDescriptor[] => {
  const seen = new Set<string>()
  const granted: CapabilityDescriptor[] = []

  for (const name of requested) {
    if (seen.has(name)) continue
    seen.add(name)

    const capability = byName.get(name)
    if (capability === undefined || capabilityPolicy(capability) === "block") continue
    granted.push(descriptorFor(capability))
  }

  return granted
}

/** Preserve a capability definition's input and output types at declaration sites. */
export const defineCapability = <Ctx, Input, Output>(
  definition: CapabilityDefinition<Ctx, Input, Output>,
): CapabilityDefinition<Ctx, Input, Output> => definition

/** Create an isolated registry that owns capability definitions and per-surface grants. */
export const createRegistry = <Ctx>(options: CreateRegistryOptions<Ctx>): Registry<Ctx> => {
  const byName = new Map<string, AnyCapabilityDefinition<Ctx>>()
  const surfaces = new Map<string, Surface>()
  let nextSurfaceId = 1

  for (const capability of options.capabilities) {
    if (!capabilityNamePattern.test(capability.name)) {
      throw new Error(`Invalid capability name: ${capability.name}`)
    }
    if (byName.has(capability.name)) {
      throw new Error(`Duplicate capability name: ${capability.name}`)
    }
    byName.set(capability.name, capability)
  }

  const createSurface = (input: CreateSurfaceInput): Surface => {
    const id = `surface-${nextSurfaceId}`
    nextSurfaceId += 1

    const capabilities = grantedCapabilities(input.requested, byName)
    const grant: Grant = { surfaceId: id, capabilities }
    const grantedNames = new Set(capabilities.map((capability) => capability.name))
    const html = sanitizeSurfaceHtml(input.html, grantedNames)
    const surface: Surface =
      input.meta === undefined
        ? { id, html, grant, dialect: genuiDialect }
        : { id, html, grant, dialect: genuiDialect, meta: input.meta }

    surfaces.set(surface.id, surface)
    return surface
  }

  const execute = async (
    call: CapabilityCall,
    ctx: Ctx,
    options?: ExecuteOptions,
  ): Promise<CapabilityResult> => {
    const surface = surfaces.get(call.surfaceId)
    if (surface === undefined) {
      return capabilityError("unknown_surface", "Surface is not available.")
    }

    const capability = byName.get(call.capability)
    if (capability !== undefined && capabilityPolicy(capability) === "block") {
      return capabilityError("blocked", "Capability is blocked.")
    }

    const descriptor = surface.grant.capabilities.find(
      (granted) => granted.name === call.capability,
    )
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

  const descriptors = (): CapabilityDescriptor[] => publicCapabilities(byName.values())

  const instructions = (): string => {
    return genui0Instructions(descriptors())
  }

  return { createSurface, execute, descriptors, instructions }
}
