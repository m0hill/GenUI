import {
  actionError,
  parseActionResult,
  type Action,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "../protocol/index.js"
import type { ContainerDimensions } from "../host-context.js"
import type {
  HostCapabilities,
  HostCapabilityName,
  HostCapabilityOutcome,
} from "./host-capabilities.js"
import { protocolChannel } from "./protocol.js"
import type { SurfaceEvent } from "./surface-events.js"
import type {
  ActionSandboxMessage,
  CapabilitySandboxMessage,
  SandboxMessage,
  SubscriptionSandboxMessage,
} from "./sandbox-message-schema.js"

/** Safe height ceiling when the host does not provide an explicit height policy. */
export const defaultMaxSurfaceHeight = 1_200
// Host capabilities use a tighter boundary than the kernel's 64 KiB action-input limit.
const maxCapabilityPayloadBytes = 16 * 1_024

export interface TransportOptions {
  readonly signal: AbortSignal
}

interface SurfaceBrokerOptions {
  readonly transport: (call: ActionCall, options: TransportOptions) => Promise<unknown>
  readonly capabilities?: HostCapabilities
  readonly confirm?: (
    action: Action,
    call: ActionCall,
    intent: string,
  ) => boolean | Promise<boolean>
  readonly containerDimensions?: ContainerDimensions
}

type HostCapabilityErrorCode = Exclude<HostCapabilityOutcome, "ok" | "superseded">

type HostCapabilityResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, never>> }
  | {
      readonly ok: false
      readonly error: { readonly code: HostCapabilityErrorCode; readonly message: string }
    }

interface SurfaceResultMessage {
  readonly channel: typeof protocolChannel
  readonly type: "result"
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly result: ActionResult
}

interface CapabilityResultMessage {
  readonly channel: typeof protocolChannel
  readonly type: "result"
  readonly surfaceId: string
  readonly callId: string
  readonly action: string
  readonly result: HostCapabilityResult
}

export type SurfaceBrokerEffect =
  | { readonly type: "emit"; readonly event: SurfaceEvent }
  | { readonly type: "set_width"; readonly width: number | undefined }
  | { readonly type: "set_height"; readonly height: number | undefined }
  | { readonly type: "post_result"; readonly message: SurfaceResultMessage }
  | { readonly type: "post_capability_result"; readonly message: CapabilityResultMessage }

export interface SurfaceBrokerTask {
  readonly effects: readonly SurfaceBrokerEffect[]
  readonly pending?: Promise<readonly SurfaceBrokerEffect[]>
}

interface SurfaceBroker {
  readonly surface: Surface
  handleSandboxMessage(
    message: Exclude<SandboxMessage, SubscriptionSandboxMessage>,
  ): SurfaceBrokerTask
  updateContainerDimensions(dimensions: ContainerDimensions | undefined): SurfaceBrokerTask
  replace(surface: Surface): void
  dispose(): void
}

interface BrokerActionRequest {
  readonly action: Action
  readonly call: ActionCall
  readonly controller: AbortController
  readonly surfaceRevision: number
}

interface BrokerCapabilityCall {
  readonly surfaceId: string
  readonly callId: string
  readonly method: CapabilitySandboxMessage["capability"]
  readonly capability: HostCapabilityName
  readonly payloadBytes: number
  readonly surfaceRevision: number
}

interface BrokerCapabilityRequest extends BrokerCapabilityCall {
  invoke(): Promise<void>
}

interface QueuedCapabilityRequest {
  readonly request: BrokerCapabilityRequest
  readonly pending: Promise<readonly SurfaceBrokerEffect[]>
  resolve(effects: readonly SurfaceBrokerEffect[]): void
}

const clampDimension = (value: number, maximum: number): number => Math.min(value, maximum)

const emit = (event: SurfaceEvent): SurfaceBrokerEffect => ({ type: "emit", event })

const capabilityError = (code: HostCapabilityErrorCode, message: string): HostCapabilityResult => ({
  ok: false,
  error: { code, message },
})

const capabilitySuccess: HostCapabilityResult = { ok: true, value: {} }

const task = (
  effects: readonly SurfaceBrokerEffect[],
  pending?: Promise<readonly SurfaceBrokerEffect[]>,
): SurfaceBrokerTask => (pending === undefined ? { effects } : { effects, pending })

const queuedCapabilityRequest = (request: BrokerCapabilityRequest): QueuedCapabilityRequest => {
  let resolvePending: ((effects: readonly SurfaceBrokerEffect[]) => void) | undefined
  const pending = new Promise<readonly SurfaceBrokerEffect[]>((resolve) => {
    resolvePending = resolve
  })
  return {
    request,
    pending,
    resolve(effects) {
      const resolve = resolvePending
      if (resolve === undefined) return
      resolvePending = undefined
      resolve(effects)
    },
  }
}

export const createSurfaceBroker = (
  initialSurface: Surface,
  options: SurfaceBrokerOptions,
): SurfaceBroker => {
  let currentSurface = initialSurface
  let disposed = false
  let surfaceRevision = 0
  let containerDimensions = options.containerDimensions
  let lastResize: { readonly width: number; readonly height: number } | undefined
  const pendingControllers = new Set<AbortController>()
  const activeCapabilityRequests = new Map<HostCapabilityName, BrokerCapabilityRequest>()
  let queuedModelContextRequest: QueuedCapabilityRequest | undefined

  const resizeEffects = (
    report: { readonly width: number; readonly height: number } | undefined,
  ): readonly SurfaceBrokerEffect[] => {
    const width =
      containerDimensions?.width ??
      (report === undefined
        ? undefined
        : containerDimensions?.maxWidth === undefined
          ? undefined
          : clampDimension(report.width, containerDimensions.maxWidth))
    const height =
      containerDimensions?.height ??
      (report === undefined
        ? undefined
        : clampDimension(report.height, containerDimensions?.maxHeight ?? defaultMaxSurfaceHeight))
    const effects: SurfaceBrokerEffect[] = [
      { type: "set_width", width },
      { type: "set_height", height },
    ]
    if (report !== undefined) {
      effects.push(
        emit({
          type: "resize",
          width: width ?? report.width,
          // A flexible height always has the explicit or default maximum above.
          height: height ?? report.height,
        }),
      )
    }
    return effects
  }

  const dimensionPolicyEffects = (): readonly SurfaceBrokerEffect[] => {
    const height =
      containerDimensions?.height ??
      (lastResize === undefined
        ? undefined
        : clampDimension(
            lastResize.height,
            containerDimensions?.maxHeight ?? defaultMaxSurfaceHeight,
          ))
    return [
      // Release a flexible width so the next innerWidth report can observe a larger container.
      { type: "set_width", width: containerDimensions?.width },
      { type: "set_height", height },
    ]
  }

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

  const capabilityOutcomeEffect = (
    callId: string,
    capability: HostCapabilityName,
    outcome: HostCapabilityOutcome,
  ): SurfaceBrokerEffect => emit({ type: "capability_result", callId, capability, outcome })

  const capabilityResultEffects = (
    surfaceId: string,
    revision: number,
    callId: string,
    method: CapabilitySandboxMessage["capability"],
    capability: HostCapabilityName,
    result: HostCapabilityResult,
    outcome: HostCapabilityOutcome,
  ): readonly SurfaceBrokerEffect[] => {
    if (disposed) return []
    const outcomeEffect = capabilityOutcomeEffect(callId, capability, outcome)
    if (surfaceRevision !== revision || currentSurface.id !== surfaceId) return [outcomeEffect]
    return [
      {
        type: "post_capability_result",
        message: {
          channel: protocolChannel,
          type: "result",
          surfaceId,
          callId,
          action: method,
          result,
        },
      },
      outcomeEffect,
    ]
  }

  const capabilityCallEffect = (call: BrokerCapabilityCall): SurfaceBrokerEffect =>
    emit({
      type: "capability_call",
      call: {
        surfaceId: call.surfaceId,
        callId: call.callId,
        capability: call.capability,
      },
      payloadBytes: call.payloadBytes,
    })

  const immediateCapabilityTask = (
    call: BrokerCapabilityCall,
    result: HostCapabilityResult,
    outcome: HostCapabilityOutcome,
  ): SurfaceBrokerTask =>
    task([
      capabilityCallEffect(call),
      ...capabilityResultEffects(
        call.surfaceId,
        call.surfaceRevision,
        call.callId,
        call.method,
        call.capability,
        result,
        outcome,
      ),
    ])

  const executeCapability = async (
    request: BrokerCapabilityRequest,
  ): Promise<readonly SurfaceBrokerEffect[]> => {
    let effects: readonly SurfaceBrokerEffect[]
    try {
      await request.invoke()
      effects = capabilityResultEffects(
        request.surfaceId,
        request.surfaceRevision,
        request.callId,
        request.method,
        request.capability,
        capabilitySuccess,
        "ok",
      )
    } catch {
      effects = capabilityResultEffects(
        request.surfaceId,
        request.surfaceRevision,
        request.callId,
        request.method,
        request.capability,
        capabilityError("denied", "Host denied the request."),
        "denied",
      )
    }

    if (activeCapabilityRequests.get(request.capability) !== request) return effects
    activeCapabilityRequests.delete(request.capability)
    if (request.capability === "updateModelContext" && queuedModelContextRequest !== undefined) {
      const queued = queuedModelContextRequest
      queuedModelContextRequest = undefined
      activeCapabilityRequests.set(request.capability, queued.request)
      void executeCapability(queued.request).then((effects) => queued.resolve(effects))
    }
    return effects
  }

  const capabilityTask = (request: BrokerCapabilityRequest): SurfaceBrokerTask => {
    if (activeCapabilityRequests.has(request.capability)) {
      return immediateCapabilityTask(
        request,
        capabilityError("rate_limited", "Host capability already has an in-flight request."),
        "rate_limited",
      )
    }
    activeCapabilityRequests.set(request.capability, request)
    return task([capabilityCallEffect(request)], executeCapability(request))
  }

  const modelContextCapabilityTask = (request: BrokerCapabilityRequest): SurfaceBrokerTask => {
    if (!activeCapabilityRequests.has(request.capability)) return capabilityTask(request)

    const queued = queuedCapabilityRequest(request)
    if (queuedModelContextRequest !== undefined) {
      const superseded = queuedModelContextRequest
      superseded.resolve(
        capabilityResultEffects(
          superseded.request.surfaceId,
          superseded.request.surfaceRevision,
          superseded.request.callId,
          superseded.request.method,
          superseded.request.capability,
          capabilitySuccess,
          "superseded",
        ),
      )
    }
    queuedModelContextRequest = queued
    return task([capabilityCallEffect(request)], queued.pending)
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

  const handleCapability = (message: CapabilitySandboxMessage): SurfaceBrokerTask => {
    const surfaceId = currentSurface.id
    const revision = surfaceRevision

    if (message.capability === "ui/update-model-context") {
      let encoded: string
      try {
        encoded = JSON.stringify(message.params)
      } catch {
        const call: BrokerCapabilityCall = {
          surfaceId,
          callId: message.callId,
          method: message.capability,
          capability: "updateModelContext",
          payloadBytes: 0,
          surfaceRevision: revision,
        }
        return immediateCapabilityTask(
          call,
          capabilityError("invalid_input", "Model context must be JSON-serializable."),
          "invalid_input",
        )
      }
      const call: BrokerCapabilityCall = {
        surfaceId,
        callId: message.callId,
        method: message.capability,
        capability: "updateModelContext",
        payloadBytes: new TextEncoder().encode(encoded).byteLength,
        surfaceRevision: revision,
      }
      const handler = options.capabilities?.updateModelContext
      if (handler === undefined) {
        return immediateCapabilityTask(
          call,
          capabilityError("not_available", "Host capability is not available."),
          "not_available",
        )
      }
      if (call.payloadBytes > maxCapabilityPayloadBytes) {
        return immediateCapabilityTask(
          call,
          capabilityError("invalid_input", "Model context exceeds 16 KiB."),
          "invalid_input",
        )
      }
      return modelContextCapabilityTask({ ...call, invoke: () => handler(message.params) })
    }

    if (message.capability === "ui/open-link") {
      const call: BrokerCapabilityCall = {
        surfaceId,
        callId: message.callId,
        method: message.capability,
        capability: "openLink",
        payloadBytes: new TextEncoder().encode(message.params.url).byteLength,
        surfaceRevision: revision,
      }
      const handler = options.capabilities?.openLink
      if (handler === undefined) {
        return immediateCapabilityTask(
          call,
          capabilityError("not_available", "Host capability is not available."),
          "not_available",
        )
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(message.params.url)
      } catch {
        return immediateCapabilityTask(
          call,
          capabilityError("invalid_input", "Link must be an absolute HTTPS URL."),
          "invalid_input",
        )
      }
      if (parsedUrl.protocol !== "https:") {
        return immediateCapabilityTask(
          call,
          capabilityError("invalid_input", "Link must be an absolute HTTPS URL."),
          "invalid_input",
        )
      }
      return capabilityTask({ ...call, invoke: () => handler(message.params) })
    }

    if (message.capability !== "ui/message") return task([])

    const call: BrokerCapabilityCall = {
      surfaceId,
      callId: message.callId,
      method: message.capability,
      capability: "sendMessage",
      payloadBytes: new TextEncoder().encode(message.params.content.text).byteLength,
      surfaceRevision: revision,
    }
    const handler = options.capabilities?.sendMessage
    if (handler === undefined) {
      return immediateCapabilityTask(
        call,
        capabilityError("not_available", "Host capability is not available."),
        "not_available",
      )
    }
    if (call.payloadBytes > maxCapabilityPayloadBytes) {
      return immediateCapabilityTask(
        call,
        capabilityError("invalid_input", "Message text exceeds 16 KiB."),
        "invalid_input",
      )
    }
    return capabilityTask({ ...call, invoke: () => handler(message.params) })
  }

  const handleSandboxMessage = (
    message: Exclude<SandboxMessage, SubscriptionSandboxMessage>,
  ): SurfaceBrokerTask => {
    if (disposed) return task([])
    if (message.surfaceId !== currentSurface.id) return task([])
    if (message.type === "heartbeat") return task([])
    if (message.type === "resize") {
      lastResize = { width: message.width, height: message.height }
      return task(resizeEffects(lastResize))
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
    if (message.type === "snapshot" || message.type === "teardown") return task([])
    if (message.type === "capability_call") return handleCapability(message)
    return handleAction(message)
  }

  return {
    get surface() {
      return currentSurface
    },
    handleSandboxMessage,
    updateContainerDimensions(dimensions) {
      if (disposed) return task([])
      containerDimensions = dimensions
      return task(dimensionPolicyEffects())
    },
    replace(surface) {
      const sameSurface = currentSurface.id === surface.id
      abortPending()
      if (queuedModelContextRequest !== undefined) {
        const queued = queuedModelContextRequest.request
        queuedModelContextRequest.resolve([
          capabilityOutcomeEffect(queued.callId, queued.capability, "superseded"),
        ])
      }
      queuedModelContextRequest = undefined
      if (!sameSurface) activeCapabilityRequests.clear()
      surfaceRevision += 1
      currentSurface = surface
      lastResize = undefined
    },
    dispose() {
      disposed = true
      abortPending()
      queuedModelContextRequest?.resolve([])
      queuedModelContextRequest = undefined
      activeCapabilityRequests.clear()
      lastResize = undefined
    },
  }
}
