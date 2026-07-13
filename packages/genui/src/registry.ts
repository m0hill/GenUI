import {
  actionError,
  isValidActionName,
  isValidSubscriptionName,
  renderActionIntent,
  type Action,
  type ActionCall,
  type ActionErrorCode,
  type ActionResult,
  type Effect,
  type MaybePromise,
  type Subscription,
  type SubscriptionOpenResult,
  type SubscriptionRequest,
  type Surface,
  type SurfaceInput,
  type SurfaceRecord,
} from "./protocol/index.js"
import { actionPolicy, projectGrantedActions, publicActions } from "./action-projections.js"
import { parseWithSchema } from "./schema.js"
import { projectGrantedSubscriptions, publicSubscriptions } from "./subscription-projections.js"
import {
  createSubscriptionRuntime,
  type SubscriptionAuditEntry,
  type SubscriptionErrorEvent,
  type SubscriptionRuntime,
} from "./subscription-runtime.js"
import { createSurfaceRuntime, type SurfaceRuntime } from "./surface-runtime.js"
import type {
  ActionDefinition,
  AnyActionDefinition,
  AnySubscriptionDefinition,
  ExecuteOptions,
  SubscribeOptions,
  SubscriptionDefinition,
  SurfaceStore,
} from "./types.js"

const maxInFlightCallsPerSurface = 8
const maxActionInputBytes = 64 * 1_024
const idempotencyWindowMs = 5 * 60 * 1_000

const serializeActionInput = (input: unknown): string | undefined => {
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return undefined
    const normalized: unknown = JSON.parse(serialized)
    return JSON.stringify(normalized, (_key: string, value: unknown): unknown => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value
      const entries = Object.entries(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      return Object.fromEntries(entries)
    })
  } catch {
    return undefined
  }
}

export interface GenuiOptions<Ctx> {
  readonly actions: readonly ActionDefinition<Ctx, unknown, unknown>[]
  readonly subscriptions?: readonly SubscriptionDefinition<Ctx, unknown, unknown>[]
  readonly store?: SurfaceStore
  readonly onCall?: (entry: CallAuditEntry) => MaybePromise<void>
  readonly onSubscription?: (entry: SubscriptionAuditEntry) => MaybePromise<void>
  /** Trusted diagnostics for internal failures hidden from generated code. */
  readonly onError?: (event: GenuiErrorEvent) => MaybePromise<void>
}

/** Emitted after every execute attempt without action input or output. */
export interface CallAuditEntry {
  readonly surfaceId: string
  readonly callId: string
  readonly subject?: string
  readonly action: string
  readonly effect: Effect | "unknown"
  readonly outcome: ActionErrorCode | "ok"
  readonly at: number
}

export type CallErrorPhase =
  | "surface_store"
  | "input_validation"
  | "approval"
  | "action"
  | "output_validation"
  | "idempotency_store"
  | "audit"

/** Trusted-side diagnostic for an internal call failure suppressed at the guest boundary. */
export interface CallErrorEvent {
  readonly type: "call"
  readonly surfaceId: string
  readonly callId: string
  readonly subject?: string
  readonly action: string
  readonly phase: CallErrorPhase
  readonly cause: unknown
}

export type GenuiErrorEvent = CallErrorEvent | SubscriptionErrorEvent

/** Preserve an action definition's input and output types at declaration sites. */
export const action = <Ctx, Input, Output>(
  definition: ActionDefinition<Ctx, Input, Output>,
): ActionDefinition<Ctx, Input, Output> => definition

/** Preserve a subscription definition's input and event types at declaration sites. */
export const subscription = <Ctx, Input, Event>(
  definition: SubscriptionDefinition<Ctx, Input, Event>,
): SubscriptionDefinition<Ctx, Input, Event> => definition

/** Owns one app action registry and its authoritative surface records. */
export class Genui<Ctx> {
  readonly #byName: ReadonlyMap<string, AnyActionDefinition<Ctx>>
  readonly #subscriptionsByName: ReadonlyMap<string, AnySubscriptionDefinition<Ctx>>
  readonly #surfaceRuntime: SurfaceRuntime
  readonly #subscriptionRuntime: SubscriptionRuntime<Ctx>
  readonly #onCall: ((entry: CallAuditEntry) => MaybePromise<void>) | undefined
  readonly #onError: ((event: GenuiErrorEvent) => MaybePromise<void>) | undefined
  readonly #inFlightBySurface = new Map<string, number>()

  constructor(options: GenuiOptions<Ctx>) {
    const byName = new Map<string, AnyActionDefinition<Ctx>>()
    const subscriptionsByName = new Map<string, AnySubscriptionDefinition<Ctx>>()

    for (const action of options.actions) {
      if (!isValidActionName(action.name)) {
        throw new Error(`Invalid action name: ${action.name}`)
      }
      if (byName.has(action.name)) {
        throw new Error(`Duplicate action name: ${action.name}`)
      }
      byName.set(action.name, action)
    }

    for (const definition of options.subscriptions ?? []) {
      if (!isValidSubscriptionName(definition.name)) {
        throw new Error(`Invalid subscription name: ${definition.name}`)
      }
      if (byName.has(definition.name) || subscriptionsByName.has(definition.name)) {
        throw new Error(`Duplicate authority name: ${definition.name}`)
      }
      if (
        definition.policy !== undefined &&
        definition.policy !== "allow" &&
        definition.policy !== "block"
      ) {
        throw new Error(`Invalid subscription policy: ${String(definition.policy)}`)
      }
      subscriptionsByName.set(definition.name, definition)
    }

    this.#byName = byName
    this.#subscriptionsByName = subscriptionsByName
    this.#surfaceRuntime = createSurfaceRuntime({
      byName,
      subscriptionsByName,
      store: options.store,
    })
    this.#onCall = options.onCall
    this.#onError = options.onError
    this.#subscriptionRuntime = createSubscriptionRuntime({
      byName: subscriptionsByName,
      surfaceRuntime: this.#surfaceRuntime,
      onSubscription: options.onSubscription,
      onError: options.onError === undefined ? undefined : (event) => options.onError?.(event),
    })
  }

  surface(input: SurfaceInput): Promise<Surface> {
    return this.#surfaceRuntime.surface(input)
  }

  reproject(id: string): Promise<Surface | undefined> {
    return this.#surfaceRuntime.reprojectSurface(id)
  }

  /** Permanently remove a surface's authority and stored idempotency state. */
  async revoke(id: string): Promise<void> {
    const revocation = this.#subscriptionRuntime.beginSurfaceRevocation(id)
    try {
      await this.#surfaceRuntime.revoke(id)
      revocation.finish("succeeded")
    } catch (cause) {
      revocation.finish("failed")
      throw cause
    }
  }

  diagnostics(id: string) {
    return this.#surfaceRuntime.diagnostics(id)
  }

  async execute(call: ActionCall, ctx: Ctx, options?: ExecuteOptions): Promise<ActionResult> {
    const result = await this.#executeResult(call, ctx, options)
    this.#emitCallAudit(call, options, result)
    return result
  }

  subscribe(
    request: SubscriptionRequest,
    ctx: Ctx,
    options?: SubscribeOptions,
  ): Promise<SubscriptionOpenResult> {
    return this.#subscriptionRuntime.open(request, ctx, options)
  }

  async #executeResult(
    call: ActionCall,
    ctx: Ctx,
    options?: ExecuteOptions,
  ): Promise<ActionResult> {
    let record: SurfaceRecord | undefined
    try {
      record = await this.#surfaceRuntime.getRecord(call.surfaceId)
    } catch (cause) {
      this.#reportCallError(call, options, "surface_store", cause)
      return actionError("storage_unavailable", "Surface store is unavailable.")
    }

    if (record === undefined) {
      return actionError("unknown_surface", "Surface is not available.")
    }

    if (record.subject !== undefined && record.subject !== options?.subject) {
      return actionError("not_granted", "Surface is not granted to this subject.")
    }

    if (
      record.surface.grant.expiresAt !== undefined &&
      record.surface.grant.expiresAt <= Date.now()
    ) {
      try {
        await this.#surfaceRuntime.revoke(call.surfaceId)
      } catch (cause) {
        this.#reportCallError(call, options, "surface_store", cause)
        return actionError("storage_unavailable", "Surface store is unavailable.")
      }
      return actionError("unknown_surface", "Surface grant has expired.")
    }

    const definition = this.#byName.get(call.action)
    if (definition !== undefined && actionPolicy(definition) === "block") {
      return actionError("blocked", "Action is blocked.")
    }

    const granted = record.surface.grant.actions.find((action) => action.name === call.action)
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
      if (!input.ok) {
        if (Object.hasOwn(input, "cause")) {
          this.#reportCallError(call, options, "input_validation", input.cause)
        }
        return actionError("invalid_input", input.message)
      }

      if (actionPolicy(definition) === "ask") {
        let approved: boolean | undefined
        try {
          approved = await options?.approve?.(granted, input.value)
        } catch (cause) {
          this.#reportCallError(call, options, "approval", cause)
          return actionError("execution_failed", "Action approval failed.")
        }
        if (approved === undefined) {
          const intent =
            granted.intent === undefined
              ? granted.description
              : renderActionIntent(granted.intent, input.value)
          return actionError("approval_required", intent)
        }
        if (!approved) return actionError("approval_denied", "Action was denied.")
      }

      try {
        const value = await definition.execute(ctx, input.value)
        if (definition.output === undefined) return { ok: true, value }

        const output = await parseWithSchema(definition.output, value)
        if (!output.ok) {
          this.#reportCallError(
            call,
            options,
            "output_validation",
            Object.hasOwn(output, "cause") ? output.cause : new Error(output.message),
          )
          return actionError("invalid_output", "Action returned invalid output.")
        }
        return { ok: true, value: output.value }
      } catch (cause) {
        this.#reportCallError(call, options, "action", cause)
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
        } catch (cause) {
          this.#reportCallError(call, options, "idempotency_store", cause)
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

  #emitCallAudit(
    call: ActionCall,
    options: ExecuteOptions | undefined,
    result: ActionResult,
  ): void {
    if (this.#onCall === undefined) return
    const entry: CallAuditEntry = {
      surfaceId: call.surfaceId,
      callId: call.callId,
      ...(options?.subject === undefined ? {} : { subject: options.subject }),
      action: call.action,
      effect: this.#byName.get(call.action)?.effect ?? "unknown",
      outcome: result.ok ? "ok" : result.error.code,
      at: Date.now(),
    }
    try {
      void Promise.resolve(this.#onCall(entry)).catch((cause: unknown) => {
        this.#reportCallError(call, options, "audit", cause)
      })
    } catch (cause) {
      this.#reportCallError(call, options, "audit", cause)
    }
  }

  #reportCallError(
    call: ActionCall,
    options: ExecuteOptions | undefined,
    phase: CallErrorPhase,
    cause: unknown,
  ): void {
    if (this.#onError === undefined) return
    const event: CallErrorEvent = {
      type: "call",
      surfaceId: call.surfaceId,
      callId: call.callId,
      ...(options?.subject === undefined ? {} : { subject: options.subject }),
      action: call.action,
      phase,
      cause,
    }
    try {
      void Promise.resolve(this.#onError(event)).catch(() => undefined)
    } catch {
      // Diagnostic hook failures are isolated from action outcomes.
    }
  }

  actions(): Action[] {
    return publicActions(this.#byName.values())
  }

  subscriptions(): Subscription[] {
    return publicSubscriptions(this.#subscriptionsByName.values())
  }

  instructions(): string {
    const projection = projectGrantedActions({
      actions: Array.from(this.#byName.keys()),
      byName: this.#byName,
    })
    const subscriptionProjection = projectGrantedSubscriptions({
      subscriptions: Array.from(this.#subscriptionsByName.keys()),
      byName: this.#subscriptionsByName,
    })
    return this.#surfaceRuntime.instructions(
      projection.actions,
      subscriptionProjection.subscriptions,
    )
  }
}
