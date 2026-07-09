import {
  actionPolicy,
  findGrantedAction,
  projectGrantedActions,
  publicActions,
} from "./action-projections.js"
import { parseWithSchema } from "./schema.js"
import { createSurfaceRuntime, type SurfaceRuntime } from "./surface-runtime.js"
import {
  actionError,
  codeDialect,
  isValidActionName,
  type Action,
  type ActionCall,
  type ActionDefinition,
  type ActionResult,
  type AnyActionDefinition,
  type Dialect,
  type ExecuteOptions,
  type Surface,
  type SurfaceInput,
  type SurfaceRecord,
  type SurfaceStore,
} from "./types.js"

export interface GenuiOptions<Ctx> {
  readonly actions: readonly AnyActionDefinition<Ctx>[]
  readonly store?: SurfaceStore
}

/** Preserve an action definition's input and output types at declaration sites. */
export const action = <Ctx, Input, Output>(
  definition: ActionDefinition<Ctx, Input, Output>,
): ActionDefinition<Ctx, Input, Output> => definition

/** Provider-independent generated UI runtime for one app authority set. */
export class Genui<Ctx> {
  readonly #byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly #surfaceRuntime: SurfaceRuntime

  constructor(options: GenuiOptions<Ctx>) {
    const byName = new Map<string, AnyActionDefinition<Ctx>>()

    for (const action of options.actions) {
      if (!isValidActionName(action.name)) {
        throw new Error(`Invalid action name: ${action.name}`)
      }
      if (byName.has(action.name)) {
        throw new Error(`Duplicate action name: ${action.name}`)
      }
      byName.set(action.name, action)
    }

    this.#byName = byName
    this.#surfaceRuntime = createSurfaceRuntime({ byName, store: options.store })
  }

  surface(input: SurfaceInput): Promise<Surface> {
    return this.#surfaceRuntime.surface(input)
  }

  reproject(id: string): Promise<Surface | undefined> {
    return this.#surfaceRuntime.reprojectSurface(id)
  }

  diagnostics(id: string) {
    return this.#surfaceRuntime.diagnostics(id)
  }

  async execute(call: ActionCall, ctx: Ctx, options?: ExecuteOptions): Promise<ActionResult> {
    let record: SurfaceRecord | undefined
    try {
      record = await this.#surfaceRuntime.getRecord(call.surfaceId)
    } catch {
      return actionError("storage_unavailable", "Surface store is unavailable.")
    }

    if (record === undefined) {
      return actionError("unknown_surface", "Surface is not available.")
    }

    const definition = this.#byName.get(call.action)
    if (definition !== undefined && actionPolicy(definition) === "block") {
      return actionError("blocked", "Action is blocked.")
    }

    const granted = findGrantedAction(record.surface.grant, call.action)
    if (granted === undefined || definition === undefined) {
      return actionError("not_granted", "Action is not granted to this surface.")
    }

    const input = await parseWithSchema(definition.input, call.input)
    if (!input.ok) return actionError("invalid_input", input.message)

    if (actionPolicy(definition) === "ask") {
      const approved = await options?.approve?.(granted, input.value)
      if (approved !== true) return actionError("approval_denied", "Action was denied.")
    }

    try {
      const value = await definition.execute(ctx, input.value)
      if (definition.output === undefined) return { ok: true, value }

      const output = await parseWithSchema(definition.output, value)
      if (!output.ok) return actionError("invalid_output", "Action returned invalid output.")
      return { ok: true, value: output.value }
    } catch {
      return actionError("execution_failed", "Action failed.")
    }
  }

  actions(): Action[] {
    return publicActions(this.#byName.values())
  }

  instructions(dialect: Dialect = codeDialect): string {
    const projection = projectGrantedActions({
      actions: Array.from(this.#byName.keys()),
      byName: this.#byName,
    })
    return this.#surfaceRuntime.instructions(projection.actions, dialect)
  }
}
