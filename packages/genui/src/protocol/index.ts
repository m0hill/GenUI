/** Buildless sandboxed HTML and JavaScript dialect. */
export const codeDialect = "code/0"

const actionNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i

/** Names start with a letter and contain at least two segments separated by `.`, `_`, or `-`. */
export const isValidActionName = (name: string): boolean => actionNamePattern.test(name)

export type MaybePromise<Value> = Value | Promise<Value>

const effects = ["local", "read", "write", "dangerous"] as const

/** Coarse effect class used for policy, approval, and product UX. */
export type Effect = (typeof effects)[number]

/** Genui policy applied before app action code can run. */
export type Policy = "allow" | "ask" | "block"

const confidentialities = ["normal", "sensitive"] as const

/** Whether an action may expose its result to the default generated-code renderer. */
export type Confidentiality = (typeof confidentialities)[number]

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
  /** Optional confirmation template; hosts must render interpolated values as untrusted text. */
  readonly intent?: string
}

const intentPlaceholderPattern = /\{input\.([^{}]+)\}/g

const readIntentPath = (input: unknown, path: string): unknown => {
  let value = input

  for (const segment of path.split(".")) {
    if (segment.length === 0 || typeof value !== "object" || value === null) return undefined
    if (!Object.hasOwn(value, segment)) return undefined
    value = Reflect.get(value, segment)
  }

  return value
}

const renderIntentValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "?"

/** Replace `{input.path}` placeholders with primitives; unresolved values become `?`. */
export const renderActionIntent = (intent: string, input: unknown): string =>
  intent.replace(intentPlaceholderPattern, (_placeholder, path: string) =>
    renderIntentValue(readIntentPath(input, path)),
  )

/** Authoritative action set projected for one generated surface. */
export interface Grant {
  readonly surfaceId: string
  /** Opaque host identity to which this authority is bound. */
  readonly subject?: string
  /** Absolute Unix epoch timestamp in milliseconds after which this grant is invalid. */
  readonly expiresAt?: number
  readonly actions: readonly Action[]
}

/** Serializable generated UI document after dialect projection and grant projection. */
export interface Surface {
  readonly id: string
  /** Dialect-defined surface content. */
  readonly content: string
  readonly grant: Grant
  readonly dialect: string
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Transport-independent request from a mounted surface to execute one action. */
export interface ActionCall {
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly input: unknown
}

const actionErrorCodes = [
  "unknown_surface",
  "not_granted",
  "blocked",
  "invalid_input",
  "invalid_output",
  "approval_required",
  "approval_denied",
  "rate_limited",
  "storage_unavailable",
  "execution_failed",
] as const

/** Stable error code returned for expected action execution failures. */
export type ActionErrorCode = (typeof actionErrorCodes)[number]

export type ActionResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error: {
        readonly code: ActionErrorCode
        readonly message: string
      }
    }

export const actionError = (code: ActionErrorCode, message: string): ActionResult => ({
  ok: false,
  error: { code, message },
})

/** Input accepted by a registry when creating a dialect-projected surface. */
export interface SurfaceInput {
  /** Defaults to code/0. */
  readonly dialect?: string
  /** Dialect-defined source content. */
  readonly content: string
  readonly actions: readonly string[]
  /** Optional opaque user or session identity bound to this surface. */
  readonly subject?: string
  /** Optional lifetime for the projected grant, in milliseconds. */
  readonly ttlMs?: number
  readonly meta?: Readonly<Record<string, unknown>>
}

/** One requested action name that was omitted while projecting a surface grant. */
export interface DroppedAction {
  readonly name: string
  readonly reason: "duplicate" | "unknown" | "blocked" | "confidential"
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
  readonly subject?: string
  readonly diagnostics: SurfaceProjectionDiagnostics
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAction = (value: unknown): value is Action =>
  isRecord(value) &&
  typeof value.name === "string" &&
  isValidActionName(value.name) &&
  typeof value.description === "string" &&
  effects.some((effect) => effect === value.effect) &&
  (value.confidentiality === undefined ||
    confidentialities.some((confidentiality) => confidentiality === value.confidentiality)) &&
  typeof value.requiresApproval === "boolean" &&
  (value.intent === undefined || typeof value.intent === "string") &&
  (value.inputSchema === undefined || isRecord(value.inputSchema))

const isGrant = (value: unknown, surfaceId: string): value is Grant =>
  isRecord(value) &&
  value.surfaceId === surfaceId &&
  (value.subject === undefined || typeof value.subject === "string") &&
  (value.expiresAt === undefined ||
    (typeof value.expiresAt === "number" &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt >= 0)) &&
  Array.isArray(value.actions) &&
  value.actions.every(isAction)

/** Return undefined unless value is a valid serialized generated UI surface. */
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

/** Return undefined unless value is a valid transport-independent action call. */
export const parseActionCall = (value: unknown): ActionCall | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.callId !== "string") return undefined
  if (typeof value.action !== "string" || !isValidActionName(value.action)) return undefined
  if (!Object.hasOwn(value, "input")) return undefined
  return {
    surfaceId: value.surfaceId,
    callId: value.callId,
    action: value.action,
    input: value.input,
  }
}

const isActionErrorCode = (value: unknown): value is ActionErrorCode =>
  actionErrorCodes.some((code) => code === value)

/** Return undefined unless value is a valid action execution result envelope. */
export const parseActionResult = (value: unknown): ActionResult | undefined => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined
  if (value.ok) return Object.hasOwn(value, "value") ? { ok: true, value: value.value } : undefined
  if (!isRecord(value.error)) return undefined
  if (!isActionErrorCode(value.error.code)) return undefined
  if (typeof value.error.message !== "string") return undefined
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message },
  }
}
