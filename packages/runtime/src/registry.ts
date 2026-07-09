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
  isValidActionName,
  type Action,
  type ActionCall,
  type ActionDefinition,
  type ActionResult,
  type AnyActionDefinition,
  type ExecuteOptions,
  type Surface,
  type SurfaceInput,
  type SurfaceRecord,
  type SurfaceStore,
} from "./types.js"

const maxInFlightCallsPerSurface = 8
const maxActionInputBytes = 64 * 1_024
const idempotencyWindowMs = 5 * 60 * 1_000

const serializeActionInput = (input: unknown): string | undefined => {
  try {
    return JSON.stringify(input)
  } catch {
    return undefined
  }
}

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
  readonly #inFlightBySurface = new Map<string, number>()

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

  /** Permanently remove a surface's authority and stored idempotency state. */
  revoke(id: string): Promise<void> {
    return this.#surfaceRuntime.revoke(id)
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

    if (
      record.surface.grant.expiresAt !== undefined &&
      record.surface.grant.expiresAt <= Date.now()
    ) {
      try {
        await this.#surfaceRuntime.revoke(call.surfaceId)
      } catch {
        return actionError("storage_unavailable", "Surface store is unavailable.")
      }
      return actionError("unknown_surface", "Surface grant has expired.")
    }

    const definition = this.#byName.get(call.action)
    if (definition !== undefined && actionPolicy(definition) === "block") {
      return actionError("blocked", "Action is blocked.")
    }

    const granted = findGrantedAction(record.surface.grant, call.action)
    if (granted === undefined || definition === undefined) {
      return actionError("not_granted", "Action is not granted to this surface.")
    }

    const serializedInput = serializeActionInput(call.input)
    if (serializedInput === undefined) {
      return actionError("invalid_input", "Action input must be JSON-serializable.")
    }
    if (new TextEncoder().encode(serializedInput).byteLength > maxActionInputBytes) {
      return actionError("invalid_input", "Action input exceeds 64 KiB.")
    }

    const inFlight = this.#inFlightBySurface.get(call.surfaceId) ?? 0
    if (inFlight >= maxInFlightCallsPerSurface) {
      return actionError("rate_limited", "Surface has too many in-flight calls.")
    }
    this.#inFlightBySurface.set(call.surfaceId, inFlight + 1)

    const executeOnce = async (): Promise<ActionResult> => {
      const input = await parseWithSchema(definition.input, call.input)
      if (!input.ok) return actionError("invalid_input", input.message)

      if (actionPolicy(definition) === "ask") {
        let approved = false
        try {
          approved = (await options?.approve?.(granted, input.value)) === true
        } catch {
          return actionError("execution_failed", "Action approval failed.")
        }
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

    try {
      if (definition.effect === "write" || definition.effect === "dangerous") {
        try {
          const idempotent = await this.#surfaceRuntime.runIdempotent(
            {
              surfaceId: call.surfaceId,
              callId: call.callId,
              fingerprint: `${call.action}\n${serializedInput}`,
              windowMs: idempotencyWindowMs,
            },
            executeOnce,
          )
          return idempotent.status === "conflict"
            ? actionError("invalid_input", "Call ID was reused with different input.")
            : idempotent.result
        } catch {
          return actionError("storage_unavailable", "Idempotency store is unavailable.")
        }
      }
      return await executeOnce()
    } finally {
      const remaining = (this.#inFlightBySurface.get(call.surfaceId) ?? 1) - 1
      if (remaining === 0) this.#inFlightBySurface.delete(call.surfaceId)
      else this.#inFlightBySurface.set(call.surfaceId, remaining)
    }
  }

  actions(): Action[] {
    return publicActions(this.#byName.values())
  }

  instructions(): string {
    const projection = projectGrantedActions({
      actions: Array.from(this.#byName.keys()),
      byName: this.#byName,
    })
    return this.#surfaceRuntime.instructions(projection.actions)
  }
}
