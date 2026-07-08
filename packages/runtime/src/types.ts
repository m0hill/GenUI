/** Current generated UI dialect understood by this runtime. */
export const genuiDialect = "genui/0"

/** Versioned generated UI interaction dialect identifier. */
export type Dialect = string

/** Value that may be returned synchronously or asynchronously by host adapters. */
export type MaybePromise<Value> = Value | Promise<Value>

/** Coarse effect class used for policy, approval, and product UX. */
export type Effect = "local" | "read" | "write" | "dangerous"

/** Genui policy applied before app action code can run. */
export type Policy = "allow" | "ask" | "block"

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
  readonly effect: Effect
  readonly policy?: Policy
  readonly input: StandardSchemaV1<unknown, Input>
  readonly output?: StandardSchemaV1<unknown, Output>
  execute(ctx: Ctx, input: Input): Output | Promise<Output>
}

/** Erased action shape stored by a GenUI instance after the schema boundary is recorded. */
export type AnyActionDefinition<Ctx> = ActionDefinition<Ctx, unknown, unknown>

/** Public action projection visible to models, sandboxes, and approval UI. */
export interface Action {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly requiresApproval: boolean
}

/** Authoritative action set projected for one generated surface. */
export interface Grant {
  readonly surfaceId: string
  readonly actions: readonly Action[]
}

/** Serializable generated UI document after sanitization and grant projection. */
export interface Surface {
  readonly id: string
  readonly html: string
  readonly grant: Grant
  readonly dialect: Dialect
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Transport-independent request from a mounted surface to execute one action. */
export interface ActionCall {
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly input: unknown
}

/** Stable error code returned for expected action execution failures. */
export type ActionErrorCode =
  | "unknown_surface"
  | "not_granted"
  | "blocked"
  | "invalid_input"
  | "invalid_output"
  | "approval_denied"
  | "storage_unavailable"
  | "execution_failed"

/** Action execution result envelope. */
export type ActionResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error: {
        readonly code: ActionErrorCode
        readonly message: string
      }
    }

/** Build the standard action failure envelope used across execution boundaries. */
export const actionError = (code: ActionErrorCode, message: string): ActionResult => ({
  ok: false,
  error: { code, message },
})

/** Input accepted by a registry when creating a sanitized surface. */
export interface SurfaceInput {
  readonly html: string
  readonly actions: readonly string[]
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Reason a requested action did not become part of a surface grant. */
export type DroppedActionReason = "duplicate" | "unknown" | "blocked"

/** One requested action name that was omitted while projecting a surface grant. */
export interface DroppedAction {
  readonly name: string
  readonly reason: DroppedActionReason
}

/** Reason the HTML sanitizer removed or rewrote an authored node or attribute. */
export type SanitizationDropReason =
  | "unsupported_node"
  | "unsupported_attribute"
  | "forbidden_element"
  | "event_handler"
  | "unsafe_style"
  | "unsafe_style_declaration"
  | "forbidden_repeated_template_attribute"
  | "form_submission_attribute"
  | "unknown_genui_attribute"
  | "invalid_genui_attribute"
  | "invalid_genui_expression"
  | "reserved_row_path"
  | "ungranted_action"
  | "forbidden_load_action"
  | "unsafe_url"
  | "url_attribute"

/** One node or attribute affected while sanitizing generated HTML. */
export interface SanitizationDrop {
  readonly node: string
  readonly attribute?: string
  readonly value?: string
  readonly reason: SanitizationDropReason
}

/** HTML sanitizer output and diagnostics. */
export interface SanitizationResult {
  readonly html: string
  readonly dropped: readonly SanitizationDrop[]
}

/** Sanitized HTML details for a generated surface. */
export interface SurfaceHtmlDiagnostics {
  readonly dropped: readonly SanitizationDrop[]
}

/** Grant projection details for a generated surface. */
export interface SurfaceProjectionDiagnostics {
  readonly actions: readonly string[]
  readonly granted: readonly string[]
  readonly dropped: readonly DroppedAction[]
  readonly html: SurfaceHtmlDiagnostics
}

/** Persistable authoritative surface record owned by the host application. */
export interface SurfaceRecord {
  readonly surface: Surface
  readonly source: SurfaceInput
  readonly diagnostics: SurfaceProjectionDiagnostics
}

/** Storage boundary for generated surface authority records. */
export interface SurfaceStore {
  get(id: string): MaybePromise<SurfaceRecord | undefined>
  set(record: SurfaceRecord): MaybePromise<void>
}

/** Optional execution hooks supplied by the host application. */
export interface ExecuteOptions {
  approve?(action: Action, call: ActionCall): boolean | Promise<boolean>
}
