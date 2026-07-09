import {
  type Action,
  type AnyActionDefinition,
  type DroppedAction,
  type Grant,
  type Policy,
} from "./types.js"

interface ProjectGrantedActionsInput<Ctx> {
  readonly actions: readonly string[]
  readonly byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
}

/** Internal projection returned when requested action names become a surface grant. */
export interface ProjectedActionGrant {
  readonly actions: readonly Action[]
  readonly dropped: readonly DroppedAction[]
}

/** Resolve the effective generated UI policy for an action definition. */
export const actionPolicy = (definition: AnyActionDefinition<unknown>): Policy =>
  definition.policy ??
  (definition.effect === "local" || definition.effect === "read" ? "allow" : "ask")

const actionFor = (definition: AnyActionDefinition<unknown>): Action => ({
  name: definition.name,
  description: definition.description,
  effect: definition.effect,
  requiresApproval: actionPolicy(definition) === "ask",
  ...(definition.intent === undefined ? {} : { intent: definition.intent }),
})

/** Project all non-blocked action definitions into descriptors visible outside GenUI. */
export const publicActions = <Ctx>(actions: Iterable<AnyActionDefinition<Ctx>>): Action[] => {
  const projected: Action[] = []
  for (const action of actions) {
    if (actionPolicy(action) !== "block") projected.push(actionFor(action))
  }
  return projected
}

/** Project model-requested action names into the per-surface authority set. */
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
    granted.push(actionFor(action))
  }

  return {
    actions: granted,
    dropped,
  }
}

/** Find the granted descriptor for an action call on a specific surface grant. */
export const findGrantedAction = (grant: Grant, actionName: string): Action | undefined =>
  grant.actions.find((action) => action.name === actionName)
