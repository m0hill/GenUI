import { z, type ZodType } from "zod"

export type GenuiEffect = "local" | "read" | "draft" | "external_write" | "dangerous"

export type GenuiCapabilityPolicy = "allow" | "require_approval" | "block"
export type GenuiCapabilityExecution = "client" | "server"

export interface GenuiCapabilityContext {
  readonly approved: boolean
  readonly chatId?: string
  readonly signal?: AbortSignal
}

export interface GenuiCapabilityDefinition<Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  readonly effect: GenuiEffect
  readonly inputSchema: ZodType<Input>
  readonly outputSchema?: ZodType<Output>
  readonly execution?: GenuiCapabilityExecution
  readonly policy?: GenuiCapabilityPolicy
  readonly requiresApproval?: boolean
  execute(ctx: GenuiCapabilityContext, input: Input): Output | Promise<Output>
}

export interface GenuiCapabilityDescriptor {
  readonly name: string
  readonly description: string
  readonly effect: GenuiEffect
  readonly execution: GenuiCapabilityExecution
  readonly requiresApproval: boolean
}

export interface GenuiCapabilityManifest {
  readonly capabilities: readonly GenuiCapabilityDescriptor[]
}

export type GenuiCapabilityResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string; readonly code?: string }

export interface GenuiCapabilityExecuteInput {
  readonly capability: string
  readonly input: unknown
  readonly approved: boolean
  readonly chatId?: string
  readonly signal?: AbortSignal
}

export const defineCapability = <Input, Output>(
  definition: GenuiCapabilityDefinition<Input, Output>,
): GenuiCapabilityDefinition<Input, Output> => definition

const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i

const isApprovalRequired = (capability: GenuiCapabilityDefinition): boolean =>
  capability.requiresApproval === true || capability.policy === "require_approval"

const descriptorFor = (capability: GenuiCapabilityDefinition): GenuiCapabilityDescriptor => ({
  name: capability.name,
  description: capability.description,
  effect: capability.effect,
  execution: capability.execution ?? "server",
  requiresApproval: isApprovalRequired(capability),
})

const validationErrorText = (error: z.ZodError): string => {
  const issue = error.issues[0]
  if (issue === undefined) return "Capability input is invalid."
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
  return `${path}${issue.message}`
}

export const createCapabilityRegistry = (capabilities: readonly GenuiCapabilityDefinition[]) => {
  const byName = new Map<string, GenuiCapabilityDefinition>()

  for (const capability of capabilities) {
    if (!capabilityNamePattern.test(capability.name)) {
      throw new Error(`Invalid capability name: ${capability.name}`)
    }
    if (byName.has(capability.name)) {
      throw new Error(`Duplicate capability name: ${capability.name}`)
    }
    byName.set(capability.name, capability)
  }

  const list = (): GenuiCapabilityDescriptor[] =>
    capabilities.filter((capability) => capability.policy !== "block").map(descriptorFor)

  const projectManifest = (names: readonly string[]): GenuiCapabilityManifest => {
    const projected: GenuiCapabilityDescriptor[] = []
    const seen = new Set<string>()

    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)

      const capability = byName.get(name)
      if (capability === undefined || capability.policy === "block") continue
      projected.push(descriptorFor(capability))
    }

    return { capabilities: projected }
  }

  const execute = async (request: GenuiCapabilityExecuteInput): Promise<GenuiCapabilityResult> => {
    const capability = byName.get(request.capability)
    if (capability === undefined) {
      return { ok: false, code: "capability_not_found", error: "Capability is not available." }
    }

    if (capability.policy === "block") {
      return { ok: false, code: "capability_blocked", error: "Capability is blocked by policy." }
    }

    if (isApprovalRequired(capability) && !request.approved) {
      return {
        ok: false,
        code: "approval_required",
        error: "Capability requires approval.",
      }
    }

    if (capability.execution === "client") {
      return {
        ok: false,
        code: "client_capability",
        error: "Capability must run in the host browser.",
      }
    }

    const parsed = capability.inputSchema.safeParse(request.input ?? {})
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid_capability_input",
        error: validationErrorText(parsed.error),
      }
    }

    try {
      const result = await capability.execute(
        {
          approved: request.approved,
          chatId: request.chatId,
          signal: request.signal,
        },
        parsed.data,
      )

      if (capability.outputSchema !== undefined) {
        const output = capability.outputSchema.safeParse(result)
        if (!output.success) {
          return {
            ok: false,
            code: "invalid_capability_output",
            error: "Capability returned invalid output.",
          }
        }
        return { ok: true, result: output.data }
      }

      return { ok: true, result }
    } catch {
      return { ok: false, code: "capability_failed", error: "Capability failed." }
    }
  }

  return { execute, list, projectManifest }
}
