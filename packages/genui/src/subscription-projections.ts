import type { DroppedSubscription, Subscription } from "./protocol/index.js"
import { subscriptionEventByteLimit } from "./protocol/index.js"
import { copyJsonSchema } from "./schema.js"
import type { AnySubscriptionDefinition } from "./types.js"

interface ProjectGrantedSubscriptionsInput<Ctx> {
  readonly subscriptions: readonly string[]
  readonly byName: ReadonlyMap<string, AnySubscriptionDefinition<Ctx>>
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

const subscriptionFor = (definition: AnySubscriptionDefinition<unknown>): Subscription => ({
  name: definition.name,
  description: definition.description,
  confidentiality: subscriptionConfidentiality(definition),
  maxEventBytes: subscriptionEventByteLimit,
  ...(definition.inputJsonSchema === undefined
    ? {}
    : { inputSchema: copyJsonSchema(definition.inputJsonSchema) }),
  ...(definition.eventJsonSchema === undefined
    ? {}
    : { eventSchema: copyJsonSchema(definition.eventJsonSchema) }),
})

export const publicSubscriptions = <Ctx>(
  subscriptions: Iterable<AnySubscriptionDefinition<Ctx>>,
): Subscription[] => {
  const projected: Subscription[] = []
  for (const definition of subscriptions) {
    if (subscriptionPolicy(definition) !== "block") projected.push(subscriptionFor(definition))
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

    const definition = byName.get(name)
    if (definition === undefined) {
      dropped.push({ name, reason: "unknown" })
      continue
    }
    if (subscriptionPolicy(definition) === "block") {
      dropped.push({ name, reason: "blocked" })
      continue
    }
    if (subscriptionConfidentiality(definition) === "sensitive") {
      dropped.push({ name, reason: "confidential" })
      continue
    }
    granted.push(subscriptionFor(definition))
  }

  return { subscriptions: granted, dropped }
}
