import { codeDialect, type Surface } from "./protocol/index.js"
import { projectGrantedActions } from "./action-projections.js"
import { codeCapabilityArtifacts } from "./code/capability-contract.js"
import { codeEnvironmentInstructions } from "./code/instructions.js"
import { projectGrantedSubscriptions } from "./subscription-projections.js"
import type { SurfaceRuntime } from "./surface-runtime.js"
import type {
  ActionDefinition,
  AnyActionDefinition,
  AnySubscriptionDefinition,
  SubscriptionDefinition,
} from "./types.js"

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

interface CreateGenerationOptions<Ctx> {
  readonly selection: GenerationOptions<Ctx>
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly subscriptionsByName: ReadonlyMap<string, AnySubscriptionDefinition<Ctx>>
  readonly surfaceRuntime: SurfaceRuntime
}

interface GenerationState {
  capabilityDeclarations(): string
}

const generationStates = new WeakMap<Generation, GenerationState>()

/** Read checker declarations from a Generation created by GenUI. */
export const generationCapabilityDeclarations = (generation: Generation): string => {
  const state = generationStates.get(generation)
  if (state === undefined) {
    throw new Error("Generated-interface checking requires a Generation created by GenUI.")
  }
  return state.capabilityDeclarations()
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
    if (byName.get(definition.name) !== definition) {
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
    if (subscriptionsByName.get(definition.name) !== definition) {
      throw new Error(`Generation subscription is not registered: ${definition.name}`)
    }
    seenSubscriptions.add(definition.name)
    subscriptionNames.push(definition.name)
  }

  const capabilityArtifacts = () => {
    const actionProjection = projectGrantedActions({ actions: actionNames, byName })
    const subscriptionProjection = projectGrantedSubscriptions({
      subscriptions: subscriptionNames,
      byName: subscriptionsByName,
    })
    return codeCapabilityArtifacts(actionProjection.actions, subscriptionProjection.subscriptions)
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
    capabilityDeclarations: () => capabilityArtifacts().declarations,
  })
  return generation
}
