/** Current generated UI dialect understood by this runtime. */
export const genuiDialect = "genui/0"

/** Versioned generated UI interaction dialect identifier. */
export type Dialect = string

/** Coarse effect class used for policy, approval, and product UX. */
export type Effect = "local" | "read" | "write" | "dangerous"

/** Registry policy applied before app capability code can run. */
export type Policy = "allow" | "require_approval" | "block"

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

/** Minimal Standard Schema v1 interface accepted by capability definitions. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardTypedV1<Input, Output>["~standard"] & {
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1Options,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  }
}

/** App-owned unit of authority that generated UI may request but never execute directly. */
export interface CapabilityDefinition<Ctx, Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly policy?: Policy
  readonly input: StandardSchemaV1<unknown, Input>
  readonly output?: StandardSchemaV1<unknown, Output>
  execute(ctx: Ctx, input: Input): Output | Promise<Output>
}

/** Erased capability shape stored by a registry after the schema boundary is recorded. */
export type AnyCapabilityDefinition<Ctx> = CapabilityDefinition<Ctx, unknown, unknown>

/** Public capability projection visible to models, sandboxes, and approval UI. */
export interface CapabilityDescriptor {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly requiresApproval: boolean
}

/** Authoritative capability set projected for one generated surface. */
export interface Grant {
  readonly surfaceId: string
  readonly capabilities: readonly CapabilityDescriptor[]
}

/** Serializable generated UI document after sanitization and grant projection. */
export interface Surface {
  readonly id: string
  readonly html: string
  readonly grant: Grant
  readonly dialect: Dialect
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Transport-independent request from a mounted surface to execute one capability. */
export interface CapabilityCall {
  readonly surfaceId: string
  readonly callId: string
  readonly capability: string
  readonly input: unknown
}

/** Stable error code returned for expected capability execution failures. */
export type CapabilityErrorCode =
  | "unknown_surface"
  | "not_granted"
  | "blocked"
  | "invalid_input"
  | "invalid_output"
  | "approval_denied"
  | "storage_unavailable"
  | "execution_failed"

/** Capability execution result envelope. */
export type CapabilityResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error: {
        readonly code: CapabilityErrorCode
        readonly message: string
      }
    }

/** Input accepted by a registry when creating a sanitized surface. */
export interface CreateSurfaceInput {
  readonly html: string
  readonly requested: readonly string[]
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Persisted source input used to reproject a surface under current runtime policy. */
export type SurfaceSource = CreateSurfaceInput

/** Persistable authoritative surface record owned by the host application. */
export interface SurfaceRecord {
  readonly surface: Surface
  readonly source: SurfaceSource
}

/** Storage boundary for generated surface authority records. */
export interface SurfaceStore {
  get(id: string): SurfaceRecord | Promise<SurfaceRecord | undefined> | undefined
  set(record: SurfaceRecord): void | Promise<void>
}

/** Optional execution hooks supplied by the host application. */
export interface ExecuteOptions {
  approve?(descriptor: CapabilityDescriptor, call: CapabilityCall): boolean | Promise<boolean>
}

/** Provider- and transport-independent generated UI registry. */
export interface Registry<Ctx> {
  createSurface(input: CreateSurfaceInput): Promise<Surface>
  execute(call: CapabilityCall, ctx: Ctx, options?: ExecuteOptions): Promise<CapabilityResult>
  descriptors(): CapabilityDescriptor[]
  instructions(): string
}
