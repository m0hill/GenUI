import type {
  Action,
  ActionResult,
  Confidentiality,
  Effect,
  JsonSchema,
  MaybePromise,
  Policy,
  SurfaceRecord,
} from "@genui/protocol"
import type { StandardSchemaV1 } from "./schema.js"

/** App-owned unit of authority that generated UI may request but never execute directly. */
export interface ActionDefinition<Ctx, Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  /** Optional raw human-facing confirmation template rendered by hosts. */
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

/** Store key for one effectful call's bounded idempotency window. */
export interface IdempotencyRequest {
  readonly surfaceId: string
  readonly callId: string
  readonly fingerprint: string
  readonly windowMs: number
}

/** Result of atomically joining or starting an idempotent action call. */
export type IdempotencyResult =
  | { readonly status: "result"; readonly result: ActionResult }
  | { readonly status: "conflict" }

/** Storage boundary for generated surface authority records. */
export interface SurfaceStore {
  get(id: string): MaybePromise<SurfaceRecord | undefined>
  set(record: SurfaceRecord): MaybePromise<void>
  revoke(id: string): MaybePromise<void>
  /** Do not retain provisional approval_required results after their callers receive them. */
  runIdempotent(
    request: IdempotencyRequest,
    operation: () => Promise<ActionResult>,
  ): MaybePromise<IdempotencyResult>
}

/** Optional execution hooks supplied by the host application. */
export interface ExecuteOptions {
  /** Opaque identity expected by a subject-bound surface. */
  readonly subject?: string
  /** Return true to approve, false to deny, or undefined when trusted consent is pending. */
  approve?(action: Action, input: unknown): MaybePromise<boolean | undefined>
}
