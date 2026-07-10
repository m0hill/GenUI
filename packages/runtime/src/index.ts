export { codeDialect, renderActionIntent } from "@genui/protocol"
export type {
  Action,
  ActionCall,
  ActionErrorCode,
  ActionResult,
  Confidentiality,
  DroppedAction,
  Effect,
  Grant,
  JsonSchema,
  MaybePromise,
  Policy,
  Surface,
  SurfaceInput,
  SurfaceProjectionDiagnostics,
  SurfaceRecord,
} from "@genui/protocol"
export { action, Genui } from "./registry.js"
export { memoryStore } from "./surface-runtime.js"
export type { CallAuditEntry, GenuiOptions } from "./registry.js"
export type {
  ActionDefinition,
  ExecuteOptions,
  IdempotencyRequest,
  IdempotencyResult,
  SurfaceStore,
} from "./types.js"
