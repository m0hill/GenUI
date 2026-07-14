import { codeDialect, type JsonSchema, type Surface } from "./protocol/index.js"
import { projectGrantedActions, type RegisteredAction } from "./action-projections.js"
import { codeCapabilityArtifacts } from "./code/capability-contract.js"
import { genuiGuestDeclarations } from "./code/guest-contract.js"
import { codeEnvironmentInstructions } from "./code/instructions.js"
import {
  projectGrantedSubscriptions,
  type RegisteredSubscription,
} from "./subscription-projections.js"
import type { SurfaceRuntime } from "./surface-runtime.js"
import type { ActionDefinition, SubscriptionDefinition } from "./types.js"

export interface GenerationOptions<Ctx> {
  readonly actions: readonly ActionDefinition<Ctx, unknown, unknown>[]
  readonly subscriptions?: readonly SubscriptionDefinition<Ctx, unknown, unknown>[]
}

export interface GenerationGuidance {
  /** Stable code/0 environment, isolation, lifecycle, styling, and bridge instructions. */
  readonly environment: string
  /** Selected, currently model-visible action and subscription declarations. */
  readonly capabilityContract: string
}

export interface CreateSurfaceOptions {
  readonly content: string
  readonly subject?: string
  readonly ttlMs?: number
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Reusable app-owned selection for model guidance and authoritative surface creation. */
export interface Generation {
  guidance(): GenerationGuidance
  createSurface(options: CreateSurfaceOptions): Promise<Surface>
}

/** Current version of the read-only package contract consumed by `@genui/check`. */
export const generationCheckerContractVersion = 1

/** One selected capability input contract exposed without executable behavior. */
export interface GenerationCheckerCapabilityInput {
  readonly kind: "action" | "subscription"
  readonly name: string
  readonly schema?: JsonSchema
}

/** Descriptive, non-authoritative facts exposed to a compatible checker package. */
export interface GenerationCheckerContract {
  readonly version: typeof generationCheckerContractVersion
  readonly dialect: typeof codeDialect
  readonly guestDeclarations: string
  readonly capabilityDeclarations: string
  readonly capabilityInputs: readonly GenerationCheckerCapabilityInput[]
}

interface CreateGenerationOptions<Ctx> {
  readonly selection: GenerationOptions<Ctx>
  readonly byName: ReadonlyMap<string, RegisteredAction<Ctx>>
  readonly subscriptionsByName: ReadonlyMap<string, RegisteredSubscription<Ctx>>
  readonly surfaceRuntime: SurfaceRuntime
}

interface GenerationState {
  checkerContract(): GenerationCheckerContract
}

const generationStates = new WeakMap<Generation, GenerationState>()

/** Read current model-visible facts from a genuine Generation without granting authority. */
export const readGenerationCheckerContract = (
  generation: Generation,
): GenerationCheckerContract | undefined => {
  const state = generationStates.get(generation)
  return state?.checkerContract()
}

export const createGeneration = <Ctx>({
  selection,
  byName,
  subscriptionsByName,
  surfaceRuntime,
}: CreateGenerationOptions<Ctx>): Generation => {
  const actionNames: string[] = []
  const seenActions = new Set<string>()
  for (const definition of selection.actions) {
    if (seenActions.has(definition.name)) {
      throw new Error(`Duplicate generation action: ${definition.name}`)
    }
    if (byName.get(definition.name)?.definition !== definition) {
      throw new Error(`Generation action is not registered: ${definition.name}`)
    }
    seenActions.add(definition.name)
    actionNames.push(definition.name)
  }

  const subscriptionNames: string[] = []
  const seenSubscriptions = new Set<string>()
  for (const definition of selection.subscriptions ?? []) {
    if (seenSubscriptions.has(definition.name)) {
      throw new Error(`Duplicate generation subscription: ${definition.name}`)
    }
    if (subscriptionsByName.get(definition.name)?.definition !== definition) {
      throw new Error(`Generation subscription is not registered: ${definition.name}`)
    }
    seenSubscriptions.add(definition.name)
    subscriptionNames.push(definition.name)
  }

  const capabilityProjection = () => {
    const actionProjection = projectGrantedActions({ actions: actionNames, byName })
    const subscriptionProjection = projectGrantedSubscriptions({
      subscriptions: subscriptionNames,
      byName: subscriptionsByName,
    })
    return {
      actions: actionProjection.actions,
      subscriptions: subscriptionProjection.subscriptions,
    }
  }

  const capabilityArtifacts = () => {
    const projection = capabilityProjection()
    return codeCapabilityArtifacts(projection.actions, projection.subscriptions)
  }

  const generation: Generation = {
    guidance: () => ({
      environment: codeEnvironmentInstructions(),
      capabilityContract: capabilityArtifacts().prompt,
    }),
    createSurface: (options) =>
      surfaceRuntime.surface({
        dialect: codeDialect,
        content: options.content,
        actions: actionNames,
        subscriptions: subscriptionNames,
        ...(options.subject === undefined ? {} : { subject: options.subject }),
        ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      }),
  }
  generationStates.set(generation, {
    checkerContract: () => {
      const projection = capabilityProjection()
      return {
        version: generationCheckerContractVersion,
        dialect: codeDialect,
        guestDeclarations: genuiGuestDeclarations,
        capabilityDeclarations: codeCapabilityArtifacts(
          projection.actions,
          projection.subscriptions,
        ).declarations,
        capabilityInputs: [
          ...projection.actions.map((action) => ({
            kind: "action" as const,
            name: action.name,
            ...(action.inputSchema === undefined ? {} : { schema: action.inputSchema }),
          })),
          ...projection.subscriptions.map((subscription) => ({
            kind: "subscription" as const,
            name: subscription.name,
            ...(subscription.inputSchema === undefined ? {} : { schema: subscription.inputSchema }),
          })),
        ],
      }
    },
  })
  return generation
}
