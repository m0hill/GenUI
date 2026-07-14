import type { DroppedSubscription, JsonSchema, Subscription } from "./protocol/index.js"
import { subscriptionEventByteLimit } from "./protocol/index.js"
import { copyJsonSchema, resolveModelJsonSchema } from "./schema.js"
import type { AnySubscriptionDefinition } from "./types.js"

export interface RegisteredSubscription<Ctx> {
  readonly definition: AnySubscriptionDefinition<Ctx>
  readonly inputSchema?: JsonSchema
  readonly eventSchema?: JsonSchema
}

interface ProjectGrantedSubscriptionsInput<Ctx> {
  readonly subscriptions: readonly string[]
  readonly byName: ReadonlyMap<string, RegisteredSubscription<Ctx>>
}

interface ProjectedSubscriptionGrant {
  readonly subscriptions: readonly Subscription[]
  readonly dropped: readonly DroppedSubscription[]
}

export const subscriptionPolicy = (
  definition: AnySubscriptionDefinition<unknown>,
): "allow" | "block" => definition.policy ?? "allow"

export const subscriptionConfidentiality = (definition: AnySubscriptionDefinition<unknown>) =>
  definition.confidentiality ?? "normal"

/** Resolve stable model schemas while retaining the app-owned definition for live policy checks. */
export const registerSubscription = <Ctx>(
  definition: AnySubscriptionDefinition<Ctx>,
): RegisteredSubscription<Ctx> => {
  const inputSchema = resolveModelJsonSchema({
    validator: definition.input,
    explicit: definition.inputJsonSchema,
    direction: "input",
    description: `subscription ${definition.name} input JSON Schema`,
  })
  const eventSchema = resolveModelJsonSchema({
    validator: definition.event,
    explicit: definition.eventJsonSchema,
    direction: "output",
    description: `subscription ${definition.name} event JSON Schema`,
  })
  return {
    definition,
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(eventSchema === undefined ? {} : { eventSchema }),
  }
}

const subscriptionFor = (registered: RegisteredSubscription<unknown>): Subscription => {
  const { definition } = registered
  return {
    name: definition.name,
    description: definition.description,
    confidentiality: subscriptionConfidentiality(definition),
    maxEventBytes: subscriptionEventByteLimit,
    ...(registered.inputSchema === undefined
      ? {}
      : { inputSchema: copyJsonSchema(registered.inputSchema) }),
    ...(registered.eventSchema === undefined
      ? {}
      : { eventSchema: copyJsonSchema(registered.eventSchema) }),
  }
}

export const publicSubscriptions = <Ctx>(
  subscriptions: Iterable<RegisteredSubscription<Ctx>>,
): Subscription[] => {
  const projected: Subscription[] = []
  for (const registered of subscriptions) {
    if (subscriptionPolicy(registered.definition) !== "block") {
      projected.push(subscriptionFor(registered))
    }
  }
  return projected
}

export const projectGrantedSubscriptions = <Ctx>({
  subscriptions,
  byName,
}: ProjectGrantedSubscriptionsInput<Ctx>): ProjectedSubscriptionGrant => {
  const seen = new Set<string>()
  const granted: Subscription[] = []
  const dropped: DroppedSubscription[] = []

  for (const name of subscriptions) {
    if (seen.has(name)) {
      dropped.push({ name, reason: "duplicate" })
      continue
    }
    seen.add(name)

    const registered = byName.get(name)
    if (registered === undefined) {
      dropped.push({ name, reason: "unknown" })
      continue
    }
    const { definition } = registered
    if (subscriptionPolicy(definition) === "block") {
      dropped.push({ name, reason: "blocked" })
      continue
    }
    if (subscriptionConfidentiality(definition) === "sensitive") {
      dropped.push({ name, reason: "confidential" })
      continue
    }
    granted.push(subscriptionFor(registered))
  }

  return { subscriptions: granted, dropped }
}
