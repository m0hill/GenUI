/** Buildless sandboxed HTML and JavaScript dialect. */
export const codeDialect = "code/0"

const actionNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i

/** Return whether a string is a valid wire-level action name. */
export const isValidActionName = (name: string): boolean => actionNamePattern.test(name)

/** Versioned generated UI interaction dialect identifier. */
export type Dialect = string

/** Value that may be returned synchronously or asynchronously by host adapters. */
export type MaybePromise<Value> = Value | Promise<Value>

/** Coarse effect class used for policy, approval, and product UX. */
export type Effect = "local" | "read" | "write" | "dangerous"

/** Genui policy applied before app action code can run. */
export type Policy = "allow" | "ask" | "block"

/** Whether an action may expose its result to the default generated-code renderer. */
export type Confidentiality = "normal" | "sensitive"

/** Dependency-free JSON Schema object used in model-facing action contracts. */
export type JsonSchema = Readonly<Record<string, unknown>>

/** Public action projection visible to models, sandboxes, and approval UI. */
export interface Action {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly confidentiality?: Confidentiality
  readonly requiresApproval: boolean
  readonly inputSchema?: JsonSchema
  /** Optional raw human-facing confirmation template rendered by hosts. */
  readonly intent?: string
}

const intentPlaceholderPattern = /\{input\.([^{}]+)\}/g

const readIntentPath = (input: unknown, path: string): unknown => {
  let value = input

  for (const segment of path.split(".")) {
    if (segment.length === 0 || typeof value !== "object" || value === null) return undefined
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined
    value = Reflect.get(value, segment)
  }

  return value
}

const renderIntentValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "?"

/** Render a human-facing action intent template against an action call input. */
export const renderActionIntent = (intent: string, input: unknown): string =>
  intent.replace(intentPlaceholderPattern, (_placeholder, path: string) =>
    renderIntentValue(readIntentPath(input, path)),
  )

/** Authoritative action set projected for one generated surface. */
export interface Grant {
  readonly surfaceId: string
  readonly actions: readonly Action[]
}

/** Serializable generated UI document after dialect projection and grant projection. */
export interface Surface {
  readonly id: string
  /** Dialect-defined surface content. */
  readonly content: string
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
  | "rate_limited"
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

/** Input accepted by a registry when creating a dialect-projected surface. */
export interface SurfaceInput {
  /** Defaults to code/0. */
  readonly dialect?: Dialect
  /** Dialect-defined source content. */
  readonly content: string
  readonly actions: readonly string[]
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Reason a requested action did not become part of a surface grant. */
export type DroppedActionReason = "duplicate" | "unknown" | "blocked" | "confidential"

/** One requested action name that was omitted while projecting a surface grant. */
export interface DroppedAction {
  readonly name: string
  readonly reason: DroppedActionReason
}

/** Grant projection details for a generated surface. */
export interface SurfaceProjectionDiagnostics {
  readonly actions: readonly string[]
  readonly granted: readonly string[]
  readonly dropped: readonly DroppedAction[]
}

/** Persistable authoritative surface record owned by the host application. */
export interface SurfaceRecord {
  readonly surface: Surface
  readonly source: SurfaceInput
  readonly diagnostics: SurfaceProjectionDiagnostics
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasOwn = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isAction = (value: unknown): value is Action =>
  isRecord(value) &&
  typeof value.name === "string" &&
  isValidActionName(value.name) &&
  typeof value.description === "string" &&
  (value.effect === "local" ||
    value.effect === "read" ||
    value.effect === "write" ||
    value.effect === "dangerous") &&
  (value.confidentiality === undefined ||
    value.confidentiality === "normal" ||
    value.confidentiality === "sensitive") &&
  typeof value.requiresApproval === "boolean" &&
  (value.intent === undefined || typeof value.intent === "string") &&
  (value.inputSchema === undefined || isRecord(value.inputSchema))

const isGrant = (value: unknown, surfaceId: string): value is Grant =>
  isRecord(value) &&
  value.surfaceId === surfaceId &&
  Array.isArray(value.actions) &&
  value.actions.every(isAction)

/** Parse an untrusted value as a serialized generated UI surface. */
export const parseSurface = (value: unknown): Surface | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string") return undefined
  if (typeof value.content !== "string") return undefined
  if (typeof value.dialect !== "string") return undefined
  if (!isGrant(value.grant, value.id)) return undefined
  if (value.meta !== undefined && !isRecord(value.meta)) return undefined
  const surface = {
    id: value.id,
    content: value.content,
    dialect: value.dialect,
    grant: value.grant,
  }
  return value.meta === undefined ? surface : { ...surface, meta: value.meta }
}

/** Parse an untrusted value as a transport-independent action call. */
export const parseActionCall = (value: unknown): ActionCall | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.callId !== "string") return undefined
  if (typeof value.action !== "string" || !isValidActionName(value.action)) return undefined
  if (!hasOwn(value, "input")) return undefined
  return {
    surfaceId: value.surfaceId,
    callId: value.callId,
    action: value.action,
    input: value.input,
  }
}

const isActionErrorCode = (value: unknown): value is ActionErrorCode =>
  value === "unknown_surface" ||
  value === "not_granted" ||
  value === "blocked" ||
  value === "invalid_input" ||
  value === "invalid_output" ||
  value === "approval_denied" ||
  value === "rate_limited" ||
  value === "storage_unavailable" ||
  value === "execution_failed"

/** Parse an untrusted value as an action execution result envelope. */
export const parseActionResult = (value: unknown): ActionResult | undefined => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined
  if (value.ok) return hasOwn(value, "value") ? { ok: true, value: value.value } : undefined
  if (!isRecord(value.error)) return undefined
  if (!isActionErrorCode(value.error.code)) return undefined
  if (typeof value.error.message !== "string") return undefined
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message },
  }
}
