import type { Action, DroppedAction, JsonSchema, Policy } from "./protocol/index.js"
import { copyJsonSchema, resolveModelJsonSchema } from "./schema.js"
import type { AnyActionDefinition } from "./types.js"

export interface RegisteredAction<Ctx> {
  readonly definition: AnyActionDefinition<Ctx>
  readonly inputSchema?: JsonSchema
  readonly outputSchema?: JsonSchema
}

interface ProjectGrantedActionsInput<Ctx> {
  readonly actions: readonly string[]
  readonly byName: ReadonlyMap<string, RegisteredAction<Ctx>>
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

/** Resolve stable model schemas while retaining the app-owned definition for live policy checks. */
export const registerAction = <Ctx>(
  definition: AnyActionDefinition<Ctx>,
): RegisteredAction<Ctx> => {
  const inputSchema = resolveModelJsonSchema({
    validator: definition.input,
    explicit: definition.inputJsonSchema,
    direction: "input",
    description: `action ${definition.name} input JSON Schema`,
  })
  const outputSchema =
    definition.output === undefined
      ? undefined
      : resolveModelJsonSchema({
          validator: definition.output,
          explicit: definition.outputJsonSchema,
          direction: "output",
          description: `action ${definition.name} output JSON Schema`,
        })
  return {
    definition,
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
  }
}

const actionFor = (registered: RegisteredAction<unknown>): Action => {
  const { definition } = registered
  return {
    name: definition.name,
    description: definition.description,
    effect: definition.effect,
    confidentiality: actionConfidentiality(definition),
    requiresApproval: actionPolicy(definition) === "ask",
    ...(definition.intent === undefined ? {} : { intent: definition.intent }),
    ...(registered.inputSchema === undefined
      ? {}
      : { inputSchema: copyJsonSchema(registered.inputSchema) }),
    ...(registered.outputSchema === undefined
      ? {}
      : { outputSchema: copyJsonSchema(registered.outputSchema) }),
  }
}

export const publicActions = <Ctx>(actions: Iterable<RegisteredAction<Ctx>>): Action[] => {
  const projected: Action[] = []
  for (const action of actions) {
    if (actionPolicy(action.definition) !== "block") projected.push(actionFor(action))
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

    const registered = byName.get(name)
    if (registered === undefined) {
      dropped.push({ name, reason: "unknown" })
      continue
    }
    const { definition } = registered
    if (actionPolicy(definition) === "block") {
      dropped.push({ name, reason: "blocked" })
      continue
    }
    if (actionConfidentiality(definition) === "sensitive") {
      dropped.push({ name, reason: "confidential" })
      continue
    }
    granted.push(actionFor(registered))
  }

  return {
    actions: granted,
    dropped,
  }
}
