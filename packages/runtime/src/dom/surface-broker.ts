import {
  actionError,
  parseActionResult,
  type Action,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "@genui/protocol"
import { protocolChannel } from "./protocol.js"
import { parseSandboxMessage, type ActionSandboxMessage } from "./sandbox-message-schema.js"

const defaultMaxHeight = 1_200

type SurfaceViolationReason =
  | "bad_message"
  | "ungranted_call"
  | "navigation"
  | "unresponsive"
  | "snapshot_timeout"

export type SurfaceEvent =
  | { readonly type: "call"; readonly call: ActionCall }
  | {
      readonly type: "result"
      readonly callId: string
      readonly action: string
      readonly result: ActionResult
    }
  | { readonly type: "resize"; readonly height: number }
  | { readonly type: "guest_error"; readonly message: string; readonly stack?: string }
  | {
      readonly type: "violation"
      readonly reason: SurfaceViolationReason
      readonly detail?: string
    }

export interface TransportOptions {
  readonly signal: AbortSignal
}

export interface SurfaceBrokerOptions {
  readonly transport: (call: ActionCall, options: TransportOptions) => Promise<ActionResult>
  readonly confirm?: (
    action: Action,
    call: ActionCall,
    intent: string,
  ) => boolean | Promise<boolean>
  readonly maxHeight?: number
}

export interface SurfaceResultMessage {
  readonly channel: string
  readonly type: "result"
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly result: ActionResult
}

export type SurfaceBrokerEffect =
  | { readonly type: "emit"; readonly event: SurfaceEvent }
  | { readonly type: "set_height"; readonly height: number }
  | { readonly type: "post_result"; readonly message: SurfaceResultMessage }

export interface SurfaceBrokerTask {
  readonly effects: readonly SurfaceBrokerEffect[]
  readonly pending?: Promise<readonly SurfaceBrokerEffect[]>
}

export interface SurfaceBroker {
  readonly surface: Surface
  handleSandboxMessage(data: unknown): SurfaceBrokerTask
  replace(surface: Surface): void
  dispose(): void
}

interface BrokerActionRequest {
  readonly action: Action
  readonly call: ActionCall
  readonly controller: AbortController
  readonly surfaceRevision: number
}

const clampHeight = (height: number, maxHeight: number): number =>
  Math.max(0, Math.min(Math.ceil(height), maxHeight))

const emit = (event: SurfaceEvent): SurfaceBrokerEffect => ({ type: "emit", event })

const task = (
  effects: readonly SurfaceBrokerEffect[],
  pending?: Promise<readonly SurfaceBrokerEffect[]>,
): SurfaceBrokerTask => (pending === undefined ? { effects } : { effects, pending })

/** Owns host-side capability enforcement for one mounted surface. */
export const createSurfaceBroker = (
  initialSurface: Surface,
  options: SurfaceBrokerOptions,
): SurfaceBroker => {
  let currentSurface = initialSurface
  let disposed = false
  let surfaceRevision = 0
  const pendingControllers = new Set<AbortController>()

  const resultEffects = (
    surfaceId: string,
    revision: number,
    callId: string,
    action: string,
    result: ActionResult,
  ): readonly SurfaceBrokerEffect[] => {
    if (disposed || surfaceRevision !== revision || currentSurface.id !== surfaceId) return []
    return [
      {
        type: "post_result",
        message: {
          channel: protocolChannel,
          type: "result",
          surfaceId,
          callId,
          action,
          result,
        },
      },
      emit({ type: "result", callId, action, result }),
    ]
  }

  const executeAction = async (
    request: BrokerActionRequest,
  ): Promise<readonly SurfaceBrokerEffect[]> => {
    pendingControllers.add(request.controller)
    try {
      let result =
        parseActionResult(
          await options.transport(request.call, { signal: request.controller.signal }),
        ) ?? actionError("execution_failed", "Action returned an invalid result.")
      if (request.controller.signal.aborted) return []

      if (!result.ok && result.error.code === "approval_required") {
        const confirmed = await options.confirm?.(
          request.action,
          request.call,
          result.error.message,
        )
        if (request.controller.signal.aborted) return []
        if (confirmed !== true) {
          return resultEffects(
            request.call.surfaceId,
            request.surfaceRevision,
            request.call.callId,
            request.call.action,
            actionError("approval_denied", "Action was denied."),
          )
        }
        result =
          parseActionResult(
            await options.transport(request.call, { signal: request.controller.signal }),
          ) ?? actionError("execution_failed", "Action returned an invalid result.")
        if (request.controller.signal.aborted) return []
      }

      return resultEffects(
        request.call.surfaceId,
        request.surfaceRevision,
        request.call.callId,
        request.call.action,
        result,
      )
    } catch {
      return resultEffects(
        request.call.surfaceId,
        request.surfaceRevision,
        request.call.callId,
        request.call.action,
        actionError("execution_failed", "Action failed."),
      )
    } finally {
      pendingControllers.delete(request.controller)
    }
  }

  const abortPending = (): void => {
    for (const controller of pendingControllers) controller.abort()
    pendingControllers.clear()
  }

  const handleAction = (message: ActionSandboxMessage): SurfaceBrokerTask => {
    const surfaceId = currentSurface.id
    const action = currentSurface.grant.actions.find(
      (descriptor) => descriptor.name === message.action,
    )
    const call: ActionCall = {
      surfaceId,
      callId: message.callId,
      action: message.action,
      input: message.input,
    }

    if (action === undefined) {
      return task([
        emit({
          type: "violation",
          reason: "ungranted_call",
          detail: `Action is not granted: ${message.action}`,
        }),
        ...resultEffects(
          surfaceId,
          surfaceRevision,
          message.callId,
          message.action,
          actionError("not_granted", "Action is not granted to this surface."),
        ),
      ])
    }

    return task(
      [emit({ type: "call", call })],
      executeAction({
        action,
        call,
        controller: new AbortController(),
        surfaceRevision,
      }),
    )
  }

  const handleSandboxMessage = (data: unknown): SurfaceBrokerTask => {
    if (disposed) return task([])
    const parsed = parseSandboxMessage(data)
    if (!parsed.ok) {
      return parsed.reason === "unknown_channel"
        ? task([])
        : task([emit({ type: "violation", reason: "bad_message" })])
    }
    const message = parsed.value

    if (message.surfaceId !== currentSurface.id) return task([])
    if (message.type === "heartbeat") return task([])
    if (message.type === "resize") {
      const height = clampHeight(message.height, options.maxHeight ?? defaultMaxHeight)
      return task([{ type: "set_height", height }, emit({ type: "resize", height })])
    }
    if (message.type === "guest_error") {
      return task([
        emit({
          type: "guest_error",
          message: message.message,
          ...(message.stack === undefined ? {} : { stack: message.stack }),
        }),
      ])
    }
    if (message.type === "snapshot") return task([])
    return handleAction(message)
  }

  return {
    get surface() {
      return currentSurface
    },
    handleSandboxMessage,
    replace(surface) {
      abortPending()
      surfaceRevision += 1
      currentSurface = surface
    },
    dispose() {
      disposed = true
      abortPending()
    },
  }
}
