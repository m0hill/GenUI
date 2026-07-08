import {
  actionError,
  type Action,
  type ActionCall,
  type ActionResult,
  type ExecuteOptions,
  type Surface,
} from "../types.js"
import { protocolChannel } from "./protocol.js"
import { normalizeResultTarget } from "./result-routing.js"
import { resultStateFromActionResult, type ResultState } from "./result-state.js"
import { parseSandboxMessage, type ActionSandboxMessage } from "./sandbox-message-schema.js"

const defaultMaxHeight = 1_200

export type SurfaceViolationReason =
  | "unknown_channel"
  | "bad_message"
  | "surface_mismatch"
  | "ungranted_call"
  | "unsafe_link"
  | "snapshot_timeout"

export type SurfaceEvent =
  | { readonly type: "call"; readonly call: ActionCall; readonly target: string }
  | {
      readonly type: "result"
      readonly callId: string
      readonly action: string
      readonly target: string
      readonly result: ActionResult
    }
  | { readonly type: "resize"; readonly height: number }
  | { readonly type: "link"; readonly href: string }
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
  readonly confirm?: NonNullable<ExecuteOptions["approve"]>
  readonly maxHeight?: number
}

export interface SurfaceResultMessage {
  readonly channel: string
  readonly type: "result"
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly target: string
  readonly result: ActionResult
  readonly state: ResultState
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
  readonly target: string
  readonly action: Action
  readonly call: ActionCall
  readonly controller: AbortController
  readonly surfaceRevision: number
}

const clampHeight = (height: number, maxHeight: number): number =>
  Math.max(0, Math.min(Math.ceil(height), maxHeight))

const safeLinkHref = (href: string): string | undefined => {
  try {
    const url = new URL(href.trim())
    return url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

const emit = (event: SurfaceEvent): SurfaceBrokerEffect => ({ type: "emit", event })

const task = (
  effects: readonly SurfaceBrokerEffect[],
  pending?: Promise<readonly SurfaceBrokerEffect[]>,
): SurfaceBrokerTask => (pending === undefined ? { effects } : { effects, pending })

/** Owns host-side protocol handling and capability-call state transitions for one surface. */
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
    target: string,
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
          target,
          result,
          state: resultStateFromActionResult(result),
        },
      },
      emit({ type: "result", callId, action, target, result }),
    ]
  }

  const executeAction = async (
    request: BrokerActionRequest,
  ): Promise<readonly SurfaceBrokerEffect[]> => {
    pendingControllers.add(request.controller)
    try {
      if (request.action.requiresApproval) {
        const confirmed = await options.confirm?.(request.action, request.call)
        if (request.controller.signal.aborted) return []
        if (confirmed !== true) {
          return resultEffects(
            request.call.surfaceId,
            request.surfaceRevision,
            request.call.callId,
            request.call.action,
            request.target,
            actionError("approval_denied", "Action was denied."),
          )
        }
      }

      return resultEffects(
        request.call.surfaceId,
        request.surfaceRevision,
        request.call.callId,
        request.call.action,
        request.target,
        await options.transport(request.call, { signal: request.controller.signal }),
      )
    } catch {
      return resultEffects(
        request.call.surfaceId,
        request.surfaceRevision,
        request.call.callId,
        request.call.action,
        request.target,
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
    const target = normalizeResultTarget(message.target, message.action)
    const grantedAction = currentSurface.grant.actions.find(
      (action) => action.name === message.action,
    )
    const call: ActionCall = {
      surfaceId,
      callId: message.callId,
      action: message.action,
      input: message.input,
    }

    if (grantedAction === undefined) {
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
          target,
          actionError("not_granted", "Action is not granted to this surface."),
        ),
      ])
    }

    return task(
      [emit({ type: "call", call, target })],
      executeAction({
        target,
        action: grantedAction,
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
      return task([emit({ type: "violation", reason: parsed.reason })])
    }
    const message = parsed.value

    if (message.surfaceId !== currentSurface.id) {
      return task([emit({ type: "violation", reason: "surface_mismatch" })])
    }

    if (message.type === "resize") {
      const height = clampHeight(message.height, options.maxHeight ?? defaultMaxHeight)
      return task([{ type: "set_height", height }, emit({ type: "resize", height })])
    }

    if (message.type === "link") {
      const href = safeLinkHref(message.href)
      return href === undefined
        ? task([
            emit({
              type: "violation",
              reason: "unsafe_link",
              detail: "Blocked unsafe link URL.",
            }),
          ])
        : task([emit({ type: "link", href })])
    }

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
