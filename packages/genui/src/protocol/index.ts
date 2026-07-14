/** Buildless sandboxed HTML and JavaScript dialect. */
export const codeDialect = "code/0"

/** Package-wide maximum for generated Surface content, measured as UTF-8 bytes. */
export const maxSurfaceContentBytes = 102_400

const surfaceContentEncoder = new TextEncoder()

const isSurfaceContentWithinLimit = (content: string): boolean =>
  surfaceContentEncoder.encode(content).byteLength <= maxSurfaceContentBytes

const actionNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i

/** Names start with a letter and contain at least two segments separated by `.`, `_`, or `-`. */
export const isValidActionName = (name: string): boolean => actionNamePattern.test(name)

/** Subscription names follow the same stable, namespaced syntax as action names. */
export const isValidSubscriptionName = (name: string): boolean => actionNamePattern.test(name)

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

/** Fixed maximum JSON-serialized size of one validated subscription event. */
export const subscriptionEventByteLimit = 64 * 1_024

/** Public action projection visible to models, sandboxes, and approval UI. */
export interface Action {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly confidentiality?: Confidentiality
  readonly requiresApproval: boolean
  readonly inputSchema?: JsonSchema
  /** Descriptive model-facing output contract; runtime validation remains authoritative. */
  readonly outputSchema?: JsonSchema
  /** Optional confirmation template; hosts must render interpolated values as untrusted text. */
  readonly intent?: string
}

/** Public read-only subscription projection visible to models and sandboxes. */
export interface Subscription {
  readonly name: string
  readonly description: string
  readonly confidentiality: Confidentiality
  readonly maxEventBytes: typeof subscriptionEventByteLimit
  readonly inputSchema?: JsonSchema
  readonly eventSchema?: JsonSchema
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
  readonly subscriptions: readonly Subscription[]
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

/** Transport-independent request to open one granted subscription. */
export interface SubscriptionRequest {
  readonly surfaceId: string
  readonly subscriptionId: string
  readonly subscription: string
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

const subscriptionErrorCodes = [
  "unknown_surface",
  "not_granted",
  "blocked",
  "invalid_input",
  "rate_limited",
  "storage_unavailable",
  "source_failed",
  "invalid_event",
  "event_too_large",
  "revoked",
  "expired",
  "not_available",
  "handler_failed",
  "ack_timeout",
  "overflow",
  "transport_failed",
] as const

/** Stable subscription failure codes shared by the kernel and browser broker. */
export type SubscriptionErrorCode = (typeof subscriptionErrorCodes)[number]

export interface SubscriptionError {
  readonly code: SubscriptionErrorCode
  readonly message: string
}

/** One validated event or terminal failure yielded by a trusted subscription transport. */
export type SubscriptionDelivery =
  | {
      readonly type: "event"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly sequence: number
      readonly event: unknown
    }
  | {
      readonly type: "error"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly error: SubscriptionError
    }

/** Expected subscription-open failures are values; accepted streams remain pull-based. */
export type SubscriptionOpenResult =
  | { readonly ok: true; readonly events: AsyncIterable<SubscriptionDelivery> }
  | { readonly ok: false; readonly error: SubscriptionError }

export const subscriptionOpenError = (
  code: SubscriptionErrorCode,
  message: string,
): SubscriptionOpenResult => ({ ok: false, error: { code, message } })

/** Input accepted by a registry when creating a dialect-projected surface. */
export interface SurfaceInput {
  /** Defaults to code/0. */
  readonly dialect?: string
  /** Dialect-defined source content. */
  readonly content: string
  readonly actions: readonly string[]
  /** Read-only subscriptions requested for this generated surface. Defaults to none. */
  readonly subscriptions?: readonly string[]
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

/** One requested subscription omitted while projecting a surface grant. */
export interface DroppedSubscription {
  readonly name: string
  readonly reason: "duplicate" | "unknown" | "blocked" | "confidential"
}

/** Grant projection details for a generated surface. */
export interface SurfaceProjectionDiagnostics {
  readonly actions: readonly string[]
  readonly granted: readonly string[]
  readonly dropped: readonly DroppedAction[]
  readonly subscriptions: readonly string[]
  readonly grantedSubscriptions: readonly string[]
  readonly droppedSubscriptions: readonly DroppedSubscription[]
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
  (value.inputSchema === undefined || isRecord(value.inputSchema)) &&
  (value.outputSchema === undefined || isRecord(value.outputSchema))

const isSubscription = (value: unknown): value is Subscription =>
  isRecord(value) &&
  typeof value.name === "string" &&
  isValidSubscriptionName(value.name) &&
  typeof value.description === "string" &&
  confidentialities.some((confidentiality) => confidentiality === value.confidentiality) &&
  value.maxEventBytes === subscriptionEventByteLimit &&
  (value.inputSchema === undefined || isRecord(value.inputSchema)) &&
  (value.eventSchema === undefined || isRecord(value.eventSchema))

const isGrant = (value: unknown, surfaceId: string): value is Grant =>
  isRecord(value) &&
  value.surfaceId === surfaceId &&
  (value.subject === undefined || typeof value.subject === "string") &&
  (value.expiresAt === undefined ||
    (typeof value.expiresAt === "number" &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt >= 0)) &&
  Array.isArray(value.actions) &&
  value.actions.every(isAction) &&
  Array.isArray(value.subscriptions) &&
  value.subscriptions.every(isSubscription)

/** Return undefined unless value is a valid serialized generated UI surface. */
export const parseSurface = (value: unknown): Surface | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string") return undefined
  if (typeof value.content !== "string" || !isSurfaceContentWithinLimit(value.content)) {
    return undefined
  }
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

const subscriptionRequestKeys: ReadonlySet<string> = new Set([
  "surfaceId",
  "subscriptionId",
  "subscription",
  "input",
])
const subscriptionEventKeys: ReadonlySet<string> = new Set([
  "type",
  "surfaceId",
  "subscriptionId",
  "sequence",
  "event",
])
const subscriptionFailureKeys: ReadonlySet<string> = new Set([
  "type",
  "surfaceId",
  "subscriptionId",
  "error",
])
const subscriptionErrorKeys: ReadonlySet<string> = new Set(["code", "message"])

const hasExactOwnKeys = (
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): boolean =>
  Object.keys(value).length === keys.size &&
  Object.keys(value).every((key) => keys.has(key)) &&
  Array.from(keys).every((key) => Object.hasOwn(value, key))

/** Return undefined unless value is an exact transport-independent subscription request. */
export const parseSubscriptionRequest = (value: unknown): SubscriptionRequest | undefined => {
  if (!isRecord(value) || !hasExactOwnKeys(value, subscriptionRequestKeys)) return undefined
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.subscriptionId !== "string") return undefined
  if (typeof value.subscription !== "string" || !isValidSubscriptionName(value.subscription)) {
    return undefined
  }
  const input = copyJsonValue(value.input)
  if (input === undefined) return undefined
  return {
    surfaceId: value.surfaceId,
    subscriptionId: value.subscriptionId,
    subscription: value.subscription,
    input: input.value,
  }
}

const copyJsonValue = (value: unknown): { readonly value: unknown } | undefined => {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : { value: JSON.parse(encoded) }
  } catch {
    return undefined
  }
}

const isActionErrorCode = (value: unknown): value is ActionErrorCode =>
  actionErrorCodes.some((code) => code === value)

const isSubscriptionErrorCode = (value: unknown): value is SubscriptionErrorCode =>
  subscriptionErrorCodes.some((code) => code === value)

/** Return undefined unless value is an exact serialized subscription error. */
export const parseSubscriptionError = (value: unknown): SubscriptionError | undefined => {
  if (!isRecord(value) || !hasExactOwnKeys(value, subscriptionErrorKeys)) return undefined
  if (!isSubscriptionErrorCode(value.code) || typeof value.message !== "string") return undefined
  return { code: value.code, message: value.message }
}

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

/** Return undefined unless value is an exact, JSON-safe subscription delivery envelope. */
export const parseSubscriptionDelivery = (value: unknown): SubscriptionDelivery | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.surfaceId !== "string" || typeof value.subscriptionId !== "string") {
    return undefined
  }
  if (value.type === "event") {
    if (!hasExactOwnKeys(value, subscriptionEventKeys)) return undefined
    if (
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence <= 0
    ) {
      return undefined
    }
    const event = copyJsonValue(value.event)
    return event === undefined
      ? undefined
      : {
          type: "event",
          surfaceId: value.surfaceId,
          subscriptionId: value.subscriptionId,
          sequence: value.sequence,
          event: event.value,
        }
  }
  if (value.type !== "error" || !hasExactOwnKeys(value, subscriptionFailureKeys)) return undefined
  const error = parseSubscriptionError(value.error)
  if (error === undefined) return undefined
  return {
    type: "error",
    surfaceId: value.surfaceId,
    subscriptionId: value.subscriptionId,
    error,
  }
}
