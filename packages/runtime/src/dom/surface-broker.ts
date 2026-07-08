import type {
  CapabilityCall,
  CapabilityDescriptor,
  CapabilityResult,
  ExecuteOptions,
  Surface,
} from "../types.js"
import { capabilityError } from "../capability-result.js"
import { protocolChannel } from "./protocol.js"
import {
  normalizeResultTarget,
  resultStateFromCapabilityResult,
  type ResultState,
} from "./result-routing.js"
import { parseSandboxMessage, type CapabilitySandboxMessage } from "./sandbox-message-schema.js"

const defaultMaxHeight = 1_200

export type SurfaceViolationReason =
  | "unknown_channel"
  | "bad_message"
  | "surface_mismatch"
  | "ungranted_call"
  | "unsafe_link"

export type SurfaceEvent =
  | { readonly type: "call"; readonly call: CapabilityCall; readonly target: string }
  | {
      readonly type: "result"
      readonly callId: string
      readonly capability: string
      readonly target: string
      readonly result: CapabilityResult
    }
  | { readonly type: "resize"; readonly height: number }
  | { readonly type: "link"; readonly href: string }
  | {
      readonly type: "violation"
      readonly reason: SurfaceViolationReason
      readonly detail?: string
    }

export interface SurfaceBrokerOptions {
  readonly transport: (call: CapabilityCall) => Promise<CapabilityResult>
  readonly approve?: NonNullable<ExecuteOptions["approve"]>
  readonly maxHeight?: number
}

export interface SurfaceResultMessage {
  readonly channel: string
  readonly type: "result"
  readonly surfaceId: string
  readonly callId: string
  readonly capability: string
  readonly target: string
  readonly result: CapabilityResult
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
  update(surface: Surface): void
  dispose(): void
}

interface BrokerCapabilityRequest {
  readonly target: string
  readonly descriptor: CapabilityDescriptor
  readonly call: CapabilityCall
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

  const resultEffects = (
    surfaceId: string,
    callId: string,
    capability: string,
    target: string,
    result: CapabilityResult,
  ): readonly SurfaceBrokerEffect[] => {
    if (disposed || currentSurface.id !== surfaceId) return []

    return [
      {
        type: "post_result",
        message: {
          channel: protocolChannel,
          type: "result",
          surfaceId,
          callId,
          capability,
          target,
          result,
          state: resultStateFromCapabilityResult(result),
        },
      },
      emit({ type: "result", callId, capability, target, result }),
    ]
  }

  const executeCapability = async (
    request: BrokerCapabilityRequest,
  ): Promise<readonly SurfaceBrokerEffect[]> => {
    try {
      if (request.descriptor.requiresApproval) {
        const approved = await options.approve?.(request.descriptor, request.call)
        if (approved !== true) {
          return resultEffects(
            request.call.surfaceId,
            request.call.callId,
            request.call.capability,
            request.target,
            capabilityError("approval_denied", "Capability was denied."),
          )
        }
      }

      return resultEffects(
        request.call.surfaceId,
        request.call.callId,
        request.call.capability,
        request.target,
        await options.transport(request.call),
      )
    } catch {
      return resultEffects(
        request.call.surfaceId,
        request.call.callId,
        request.call.capability,
        request.target,
        capabilityError("execution_failed", "Capability failed."),
      )
    }
  }

  const handleCapability = (message: CapabilitySandboxMessage): SurfaceBrokerTask => {
    const surfaceId = currentSurface.id
    const target = normalizeResultTarget(message.target, message.capability)
    const descriptor = currentSurface.grant.capabilities.find(
      (capability) => capability.name === message.capability,
    )
    const call: CapabilityCall = {
      surfaceId,
      callId: message.callId,
      capability: message.capability,
      input: message.input,
    }

    if (descriptor === undefined) {
      return task([
        emit({
          type: "violation",
          reason: "ungranted_call",
          detail: `Capability is not granted: ${message.capability}`,
        }),
        ...resultEffects(
          surfaceId,
          message.callId,
          message.capability,
          target,
          capabilityError("not_granted", "Capability is not granted to this surface."),
        ),
      ])
    }

    return task(
      [emit({ type: "call", call, target })],
      executeCapability({
        target,
        descriptor,
        call,
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

    return handleCapability(message)
  }

  return {
    get surface() {
      return currentSurface
    },
    handleSandboxMessage,
    update(surface) {
      currentSurface = surface
    },
    dispose() {
      disposed = true
    },
  }
}
