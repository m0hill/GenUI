import type {
  Action,
  Confidentiality,
  Effect,
  JsonSchema,
  MaybePromise,
  Policy,
  SurfaceRecord,
} from "@genui/protocol"

export {
  actionError,
  codeDialect,
  genuiDialect,
  isValidActionName,
  parseActionCall,
  parseActionResult,
  parseSurface,
  renderActionIntent,
} from "@genui/protocol"
export type {
  Action,
  ActionCall,
  ActionErrorCode,
  ActionResult,
  Confidentiality,
  Dialect,
  DroppedAction,
  DroppedActionReason,
  Effect,
  Grant,
  JsonSchema,
  MaybePromise,
  Policy,
  SanitizationDrop,
  SanitizationDropReason,
  SanitizationResult,
  Surface,
  SurfaceHtmlDiagnostics,
  SurfaceInput,
  SurfaceProjectionDiagnostics,
  SurfaceRecord,
} from "@genui/protocol"

/** Minimal Standard Schema issue shape used by the runtime boundary parser. */
export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined
}

/** Minimal Standard Schema path segment shape. */
export interface StandardSchemaPathSegment {
  readonly key: PropertyKey
}

/** Minimal Standard Schema options shape. */
export interface StandardSchemaV1Options {
  readonly libraryOptions?: Readonly<Record<string, unknown>> | undefined
}

/** Minimal Standard Schema v1 parse result shape. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] }

/** Minimal Standard Schema type metadata shape. */
export interface StandardSchemaTypes<Input = unknown, Output = Input> {
  readonly input: Input
  readonly output: Output
}

/** Minimal Standard Typed v1 interface accepted by Standard Schema. */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly types?: StandardSchemaTypes<Input, Output> | undefined
  }
}

/** Minimal Standard Schema v1 interface accepted by action definitions. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardTypedV1<Input, Output>["~standard"] & {
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1Options,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  }
}

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

/** Storage boundary for generated surface authority records. */
export interface SurfaceStore {
  get(id: string): MaybePromise<SurfaceRecord | undefined>
  set(record: SurfaceRecord): MaybePromise<void>
}

/** Optional execution hooks supplied by the host application. */
export interface ExecuteOptions {
  /** Authoritatively approve an action using its schema-validated canonical input. */
  approve?(action: Action, input: unknown): boolean | Promise<boolean>
}
