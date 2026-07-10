import type { Action, DroppedAction, Policy } from "@genui/protocol"
import type { AnyActionDefinition } from "./types.js"

interface ProjectGrantedActionsInput<Ctx> {
  readonly actions: readonly string[]
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
}

interface ProjectedActionGrant {
  readonly actions: readonly Action[]
  readonly dropped: readonly DroppedAction[]
}

export const actionPolicy = (definition: AnyActionDefinition<unknown>): Policy =>
  definition.policy ??
  (definition.effect === "local" || definition.effect === "read" ? "allow" : "ask")

const actionConfidentiality = (definition: AnyActionDefinition<unknown>) =>
  definition.confidentiality ?? "normal"

const actionFor = (definition: AnyActionDefinition<unknown>): Action => ({
  name: definition.name,
  description: definition.description,
  effect: definition.effect,
  confidentiality: actionConfidentiality(definition),
  requiresApproval: actionPolicy(definition) === "ask",
  ...(definition.intent === undefined ? {} : { intent: definition.intent }),
  ...(definition.inputJsonSchema === undefined ? {} : { inputSchema: definition.inputJsonSchema }),
})

export const publicActions = <Ctx>(actions: Iterable<AnyActionDefinition<Ctx>>): Action[] => {
  const projected: Action[] = []
  for (const action of actions) {
    if (actionPolicy(action) !== "block") projected.push(actionFor(action))
  }
  return projected
}

export const projectGrantedActions = <Ctx>({
  actions,
  byName,
}: ProjectGrantedActionsInput<Ctx>): ProjectedActionGrant => {
  const seen = new Set<string>()
  const granted: Action[] = []
  const dropped: DroppedAction[] = []

  for (const name of actions) {
    if (seen.has(name)) {
      dropped.push({ name, reason: "duplicate" })
      continue
    }
    seen.add(name)

    const action = byName.get(name)
    if (action === undefined) {
      dropped.push({ name, reason: "unknown" })
      continue
    }
    if (actionPolicy(action) === "block") {
      dropped.push({ name, reason: "blocked" })
      continue
    }
    if (actionConfidentiality(action) === "sensitive") {
      dropped.push({ name, reason: "confidential" })
      continue
    }
    granted.push(actionFor(action))
  }

  return {
    actions: granted,
    dropped,
  }
}
