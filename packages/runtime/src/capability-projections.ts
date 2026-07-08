import {
  type AnyCapabilityDefinition,
  type CapabilityDescriptor,
  type Grant,
  type Policy,
} from "./types.js"

interface ProjectGrantedCapabilitiesInput<Ctx> {
  readonly requested: readonly string[]
  readonly byName: ReadonlyMap<string, AnyCapabilityDefinition<Ctx>>
}

/** Internal projection returned when requested capability names become a surface grant. */
export interface ProjectedCapabilityGrant {
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly names: ReadonlySet<string>
}

/** Resolve the effective generated UI policy for a capability definition. */
export const capabilityPolicy = (definition: AnyCapabilityDefinition<unknown>): Policy =>
  definition.policy ?? "allow"

const descriptorFor = (definition: AnyCapabilityDefinition<unknown>): CapabilityDescriptor => ({
  name: definition.name,
  description: definition.description,
  effect: definition.effect,
  requiresApproval: capabilityPolicy(definition) === "require_approval",
})

/** Project all non-blocked capability definitions into descriptors visible outside the registry. */
export const publicCapabilityDescriptors = <Ctx>(
  capabilities: Iterable<AnyCapabilityDefinition<Ctx>>,
): CapabilityDescriptor[] => {
  const descriptors: CapabilityDescriptor[] = []
  for (const capability of capabilities) {
    if (capabilityPolicy(capability) !== "block") descriptors.push(descriptorFor(capability))
  }
  return descriptors
}

/** Project model-requested capability names into the per-surface authority set. */
export const projectGrantedCapabilities = <Ctx>({
  requested,
  byName,
}: ProjectGrantedCapabilitiesInput<Ctx>): ProjectedCapabilityGrant => {
  const seen = new Set<string>()
  const capabilities: CapabilityDescriptor[] = []

  for (const name of requested) {
    if (seen.has(name)) continue
    seen.add(name)

    const capability = byName.get(name)
    if (capability === undefined || capabilityPolicy(capability) === "block") continue
    capabilities.push(descriptorFor(capability))
  }

  return {
    capabilities,
    names: new Set(capabilities.map((capability) => capability.name)),
  }
}

/** Find the granted descriptor for a capability call on a specific surface grant. */
export const findGrantedCapability = (
  grant: Grant,
  capabilityName: string,
): CapabilityDescriptor | undefined =>
  grant.capabilities.find((capability) => capability.name === capabilityName)
