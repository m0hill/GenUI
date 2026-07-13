import type {
  Action,
  ActionResult,
  Confidentiality,
  Effect,
  JsonSchema,
  MaybePromise,
  Policy,
  SurfaceRecord,
} from "./protocol/index.js"
import type { StandardSchemaV1 } from "./schema.js"

/** App-owned unit of authority that generated UI may request but never execute directly. */
export interface ActionDefinition<Ctx, Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  /** Hosts render this template as plain text; interpolated input remains untrusted display data. */
  readonly intent?: string
  readonly effect: Effect
  readonly confidentiality?: Confidentiality
  readonly policy?: Policy
  readonly input: StandardSchemaV1<unknown, Input>
  readonly inputJsonSchema?: JsonSchema
  readonly output?: StandardSchemaV1<unknown, Output>
  readonly outputJsonSchema?: JsonSchema
  execute(ctx: Ctx, input: Input): Output | Promise<Output>
}

/** Erased action shape stored by a GenUI instance after the schema boundary is recorded. */
export type AnyActionDefinition<Ctx> = ActionDefinition<Ctx, unknown, unknown>

/** Read-only app-owned event source that generated UI may subscribe to when granted. */
export interface SubscriptionDefinition<Ctx, Input = unknown, Event = unknown> {
  readonly name: string
  readonly description: string
  readonly confidentiality?: Confidentiality
  readonly policy?: Exclude<Policy, "ask">
  readonly input: StandardSchemaV1<unknown, Input>
  readonly inputJsonSchema?: JsonSchema
  readonly event: StandardSchemaV1<unknown, Event>
  readonly eventJsonSchema?: JsonSchema
  subscribe(
    ctx: Ctx,
    input: Input,
    options: { readonly signal: AbortSignal },
  ): MaybePromise<AsyncIterable<Event>>
}

/** Erased subscription definition retained after its schema boundary is recorded. */
export type AnySubscriptionDefinition<Ctx> = SubscriptionDefinition<Ctx, unknown, unknown>

/** One effectful action call coordinated atomically by a SurfaceStore. */
export interface SurfaceStoreIdempotencyRequest {
  readonly surfaceId: string
  readonly callId: string
  readonly fingerprint: string
  readonly windowMs: number
}

/** Stored or newly completed action result, or a conflicting call fingerprint. */
export type SurfaceStoreIdempotencyResult =
  | { readonly status: "result"; readonly result: ActionResult }
  | { readonly status: "conflict" }

/** Preserves authoritative records and atomically deduplicates effectful calls across replicas. */
export interface SurfaceStore {
  get(id: string): MaybePromise<SurfaceRecord | undefined>
  set(record: SurfaceRecord): MaybePromise<void>
  revoke(id: string): MaybePromise<void>
  /** Atomically join matching calls; never retain provisional approval_required results. */
  runIdempotent(
    request: SurfaceStoreIdempotencyRequest,
    operation: () => Promise<ActionResult>,
  ): MaybePromise<SurfaceStoreIdempotencyResult>
}

export interface ExecuteOptions {
  /** Opaque identity expected by a subject-bound surface. */
  readonly subject?: string
  /** Return true to approve, false to deny, or undefined when trusted consent is pending. */
  approve?(action: Action, input: unknown): MaybePromise<boolean | undefined>
}

export interface SubscribeOptions {
  /** Opaque identity expected by a subject-bound surface. */
  readonly subject?: string
  /** Trusted transport cancellation; the kernel always creates its own source signal. */
  readonly signal?: AbortSignal
}
