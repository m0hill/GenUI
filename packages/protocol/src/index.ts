/** Current generated UI dialect understood by this runtime. */
export const genuiDialect = "genui/0"

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

/** Public action projection visible to models, sandboxes, and approval UI. */
export interface Action {
  readonly name: string
  readonly description: string
  readonly effect: Effect
  readonly confidentiality?: Confidentiality
  readonly requiresApproval: boolean
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
  /** Dialect-defined surface content; genui/0 uses sanitized fragment HTML. */
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
  /** Dialect-defined source content; genui/0 expects fragment HTML. */
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
