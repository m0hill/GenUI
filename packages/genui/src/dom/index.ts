import { codeDialect, type Action, type ActionCall, type Surface } from "../protocol/index.js"
import { codeBootstrapScript } from "../code/bootstrap.js"
import { parseHostContext, renderHostStyleVariables, type HostContext } from "../host-context.js"
import { createHeartbeatTripwire, type HeartbeatTripwire } from "./heartbeat-tripwire.js"
import type { HostCapabilities, HostCapabilityFlags } from "./host-capabilities.js"
import { protocolChannel } from "./protocol.js"
import {
  parseSandboxMessage,
  parseSnapshotValue,
  type SnapshotSandboxMessage,
  type SnapshotValue,
  type TeardownSandboxMessage,
} from "./sandbox-message-schema.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
  type SurfaceEvent,
  type TransportOptions,
} from "./surface-broker.js"

export type { SurfaceEvent } from "./surface-broker.js"
export type { HostContext, McpUiStyleVariableKey } from "../host-context.js"
export type {
  HostCapabilities,
  HostCapabilityName,
  HostCapabilityOutcome,
  OpenLinkParams,
  SendMessageParams,
  UpdateModelContextParams,
} from "./host-capabilities.js"

interface MountOptions {
  readonly transport: (call: ActionCall, options: TransportOptions) => Promise<unknown>
  /** Trusted consent UI using the kernel-rendered canonical action intent. */
  readonly confirm?: (
    action: Action,
    call: ActionCall,
    intent: string,
  ) => boolean | Promise<boolean>
  /** HTTPS policies permit outbound image requests and can exfiltrate sandbox-visible data. */
  readonly imagePolicy?: ImagePolicy
  /** MCP Apps-compatible theme and standardized CSS variables supplied by trusted host code. */
  readonly hostContext?: HostContext
  /** Optional host functions advertised to and callable by the generated surface. */
  readonly capabilities?: HostCapabilities
  readonly maxHeight?: number
  readonly onEvent?: (event: SurfaceEvent) => void
  readonly snapshot?: SnapshotValue
  readonly snapshotTimeoutMs?: number
}

type ImagePolicy = "none" | "data" | "https" | "https-and-data"

interface ReplaceOptions {
  readonly snapshot?: SnapshotValue
}

interface TeardownOptions {
  readonly reason?: string
  readonly timeoutMs?: number
}

export interface Mounted {
  readonly surface: Surface
  snapshot(): Promise<SnapshotValue | undefined>
  replace(surface: Surface, options?: ReplaceOptions): Promise<void>
  /** Apply theme changes live; style-variable changes render on the next replacement. */
  updateHostContext(partial: HostContext): void
  /** Ask the guest to clean up and return its final snapshot before disposal. */
  teardown(options?: TeardownOptions): Promise<SnapshotValue | undefined>
  dispose(): void
}

interface PendingSnapshotRequest {
  readonly surfaceId: string
  readonly timeout: ReturnType<typeof setTimeout>
  resolve(snapshot: SnapshotValue | undefined): void
}

interface PendingTeardownRequest {
  readonly surfaceId: string
  readonly requestId: string
  readonly timeout: ReturnType<typeof setTimeout>
  resolve(snapshot: SnapshotValue | undefined): void
}

const defaultSnapshotTimeoutMs = 1_000
const defaultTeardownTimeoutMs = 1_000
const maxTeardownReasonLength = 256

const imageSourcePolicy = (policy: ImagePolicy): string => {
  if (policy === "data") return "data:"
  if (policy === "https") return "https:"
  if (policy === "https-and-data") return "https: data:"
  return "'none'"
}

const surfaceDocument = (
  surface: Surface,
  imagePolicy: ImagePolicy,
  hostContext: HostContext,
  capabilities: HostCapabilityFlags,
  restore?: SnapshotValue,
): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${imageSourcePolicy(imagePolicy)}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
${renderHostStyleVariables(hostContext)}</head>
<body><script>${codeBootstrapScript({ channel: protocolChannel, surfaceId: surface.id, actions: surface.grant.actions, ...capabilities, ...(restore === undefined ? {} : { restore }), ...(hostContext.theme === undefined ? {} : { theme: hostContext.theme }) })}</script>${surface.content}</body>
</html>`

const assertSupportedSurface = (surface: Surface): void => {
  if (surface.dialect !== codeDialect) {
    throw new Error(`Unsupported generated UI dialect: ${surface.dialect}`)
  }
}

/** Mount generated code into an isolated iframe and broker its action calls. */
export const mount = (element: Element, surface: Surface, options: MountOptions): Mounted => {
  assertSupportedSurface(surface)
  let hostContext = options.hostContext === undefined ? {} : parseHostContext(options.hostContext)
  const hostCapabilities: HostCapabilities = { ...options.capabilities }
  const capabilityFlags: HostCapabilityFlags = {
    sendMessage: hostCapabilities.sendMessage !== undefined,
    openLink: hostCapabilities.openLink !== undefined,
    updateModelContext: hostCapabilities.updateModelContext !== undefined,
  }
  const ownerDocument = element.ownerDocument
  const imagePolicy = options.imagePolicy ?? "none"
  const initialSnapshot = options.snapshot
  const snapshotTimeoutMs =
    typeof options.snapshotTimeoutMs === "number" &&
    Number.isFinite(options.snapshotTimeoutMs) &&
    options.snapshotTimeoutMs >= 0
      ? options.snapshotTimeoutMs
      : defaultSnapshotTimeoutMs
  let disposed = false
  let terminated = false
  let expectedDocumentLoads = 0
  let nextSnapshotRequestId = 1
  let nextTeardownRequestId = 1
  let replacementQueue = Promise.resolve()
  let teardownPromise: Promise<SnapshotValue | undefined> | undefined
  let pendingTeardown: PendingTeardownRequest | undefined
  let errorElement: Element | undefined
  let heartbeatTripwire: HeartbeatTripwire | undefined
  let intersectionObserver: IntersectionObserver | undefined
  const pendingSnapshots = new Map<string, PendingSnapshotRequest>()

  const broker = createSurfaceBroker(surface, {
    transport: options.transport,
    capabilities: hostCapabilities,
    confirm: options.confirm,
    maxHeight: options.maxHeight,
  })
  const iframe = ownerDocument.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts allow-forms")
  iframe.setAttribute("referrerpolicy", "no-referrer")
  iframe.style.border = "0"
  iframe.style.display = "block"
  iframe.style.width = "100%"

  const emit = (event: SurfaceEvent): void => options.onEvent?.(event)

  const postHostTheme = (theme: "light" | "dark"): void => {
    iframe.contentWindow?.postMessage(
      {
        channel: protocolChannel,
        type: "host_context_changed",
        surfaceId: broker.surface.id,
        theme,
      },
      "*",
    )
  }

  const applyEffect = (effect: SurfaceBrokerEffect): void => {
    if (disposed || terminated) return
    if (effect.type === "emit") {
      emit(effect.event)
      return
    }
    if (effect.type === "set_height") {
      iframe.style.height = `${effect.height}px`
      return
    }
    iframe.contentWindow?.postMessage(effect.message, "*")
  }

  const applyTask = (task: SurfaceBrokerTask): void => {
    for (const effect of task.effects) applyEffect(effect)
    if (task.pending !== undefined) {
      void task.pending.then((effects) => effects.forEach(applyEffect))
    }
  }

  const finishSnapshotRequest = (requestId: string, snapshot: SnapshotValue | undefined): void => {
    const pending = pendingSnapshots.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timeout)
    pendingSnapshots.delete(requestId)
    pending.resolve(snapshot)
  }

  const finishPendingSnapshots = (): void => {
    for (const requestId of Array.from(pendingSnapshots.keys())) {
      finishSnapshotRequest(requestId, undefined)
    }
  }

  const handleVisibilityChange = (): void => {
    heartbeatTripwire?.setDocumentVisible(ownerDocument.visibilityState === "visible")
  }

  const stopMonitoring = (): void => {
    ownerDocument.removeEventListener("visibilitychange", handleVisibilityChange)
    intersectionObserver?.disconnect()
    heartbeatTripwire?.dispose()
  }

  const finishPendingTeardown = (snapshot: SnapshotValue | undefined): void => {
    const pending = pendingTeardown
    if (pending === undefined) return
    clearTimeout(pending.timeout)
    pendingTeardown = undefined
    pending.resolve(snapshot)
  }

  const disposeMount = (snapshot: SnapshotValue | undefined): void => {
    if (disposed) return
    disposed = true
    try {
      broker.dispose()
      finishPendingSnapshots()
      stopMonitoring()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.removeEventListener("load", handleLoad)
      iframe.remove()
      errorElement?.remove()
    } finally {
      finishPendingTeardown(snapshot)
    }
  }

  const terminate = (reason: "navigation" | "unresponsive", message: string): void => {
    if (disposed || terminated) return
    terminated = true
    try {
      emit({ type: "violation", reason })
      broker.dispose()
      finishPendingSnapshots()
      stopMonitoring()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.removeEventListener("load", handleLoad)

      const error = ownerDocument.createElement("div")
      error.setAttribute("role", "alert")
      error.textContent = message
      errorElement = error
      element.replaceChildren(error)
    } finally {
      finishPendingTeardown(undefined)
    }
  }

  const requestSnapshot = (surfaceId: string): Promise<SnapshotValue | undefined> => {
    const target = iframe.contentWindow
    if (disposed || terminated || target === null) return Promise.resolve(undefined)
    const requestId = `snapshot-${nextSnapshotRequestId++}`

    return new Promise<SnapshotValue | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        if (!disposed && !terminated) {
          emit({
            type: "violation",
            reason: "snapshot_timeout",
            detail: `Surface snapshot timed out after ${snapshotTimeoutMs}ms.`,
          })
        }
        finishSnapshotRequest(requestId, undefined)
      }, snapshotTimeoutMs)
      pendingSnapshots.set(requestId, { surfaceId, timeout, resolve })
      target.postMessage(
        { channel: protocolChannel, type: "snapshot_request", surfaceId, requestId },
        "*",
      )
    })
  }

  const handleSnapshotMessage = (message: SnapshotSandboxMessage): void => {
    const pending = pendingSnapshots.get(message.requestId)
    if (pending === undefined) return
    if (message.surfaceId !== pending.surfaceId || message.surfaceId !== broker.surface.id) return
    finishSnapshotRequest(message.requestId, message.ok ? message.value : undefined)
  }

  const handleTeardownMessage = (message: TeardownSandboxMessage): void => {
    const pending = pendingTeardown
    if (pending === undefined || message.requestId !== pending.requestId) return
    if (message.surfaceId !== pending.surfaceId || message.surfaceId !== broker.surface.id) return
    disposeMount(message.ok ? message.value : undefined)
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || terminated || event.source !== iframe.contentWindow) return
    const parsed = parseSandboxMessage(event.data)
    if (!parsed.ok) {
      if (parsed.reason === "bad_message") emit({ type: "violation", reason: "bad_message" })
      return
    }
    if (parsed.value.type === "heartbeat") {
      if (parsed.value.surfaceId === broker.surface.id) heartbeatTripwire?.heartbeat()
      return
    }
    if (parsed.value.type === "snapshot") {
      handleSnapshotMessage(parsed.value)
      return
    }
    if (parsed.value.type === "teardown") {
      handleTeardownMessage(parsed.value)
      return
    }
    applyTask(broker.handleSandboxMessage(parsed.value))
  }

  const handleLoad = (): void => {
    if (disposed || terminated) return
    if (expectedDocumentLoads > 0) {
      expectedDocumentLoads -= 1
      if (hostContext.theme !== undefined) postHostTheme(hostContext.theme)
      return
    }

    terminate("navigation", "Generated UI navigation blocked.")
  }

  const setDocument = (nextSurface: Surface, restore?: SnapshotValue): void => {
    heartbeatTripwire?.reset()
    expectedDocumentLoads += 1
    iframe.srcdoc = surfaceDocument(nextSurface, imagePolicy, hostContext, capabilityFlags, restore)
  }

  const ownerWindow = ownerDocument.defaultView
  heartbeatTripwire = createHeartbeatTripwire({
    now: () => ownerWindow?.performance.now() ?? Date.now(),
    schedule: (check, intervalMs) => {
      if (ownerWindow === null) return () => undefined
      const intervalId = ownerWindow.setInterval(check, intervalMs)
      return () => ownerWindow.clearInterval(intervalId)
    },
    onUnresponsive: () => terminate("unresponsive", "Generated UI became unresponsive."),
  })
  handleVisibilityChange()
  ownerDocument.addEventListener("visibilitychange", handleVisibilityChange)
  if (ownerWindow !== null && typeof ownerWindow.IntersectionObserver === "function") {
    intersectionObserver = new ownerWindow.IntersectionObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === iframe)
      if (entry !== undefined) heartbeatTripwire?.setIntersecting(entry.isIntersecting)
    })
    intersectionObserver.observe(iframe)
  }

  ownerWindow?.addEventListener("message", handleMessage)
  iframe.addEventListener("load", handleLoad)
  setDocument(broker.surface, initialSnapshot)
  element.replaceChildren(iframe)

  return {
    get surface() {
      return broker.surface
    },
    snapshot() {
      return requestSnapshot(broker.surface.id)
    },
    replace(nextSurface, replaceOptions = {}) {
      assertSupportedSurface(nextSurface)
      const explicitSnapshot =
        replaceOptions.snapshot === undefined
          ? undefined
          : parseSnapshotValue(replaceOptions.snapshot)
      if (replaceOptions.snapshot !== undefined && explicitSnapshot === undefined) {
        throw new TypeError("Snapshot must be JSON-serializable.")
      }
      // Copy before queuing so later caller mutation cannot change the replacement.
      const replacement = replacementQueue.then(async () => {
        if (disposed || terminated || teardownPromise !== undefined) return
        const current = broker.surface
        const restore =
          explicitSnapshot !== undefined
            ? explicitSnapshot
            : nextSurface.id === current.id
              ? await requestSnapshot(current.id)
              : undefined
        if (disposed || terminated || teardownPromise !== undefined) return
        broker.replace(nextSurface)
        setDocument(nextSurface, restore)
      })
      replacementQueue = replacement.catch(() => undefined)
      return replacement
    },
    updateHostContext(partial) {
      const update = parseHostContext(partial)
      if (disposed || terminated || teardownPromise !== undefined) return
      hostContext = { ...hostContext, ...update }
      if (update.theme === undefined) return
      postHostTheme(update.theme)
    },
    teardown(teardownOptions = {}) {
      const reason = teardownOptions.reason
      if (
        reason !== undefined &&
        (typeof reason !== "string" || reason.length > maxTeardownReasonLength)
      ) {
        throw new TypeError(
          `Teardown reason must be a string of at most ${maxTeardownReasonLength} characters.`,
        )
      }
      const timeoutMs =
        teardownOptions.timeoutMs === undefined
          ? defaultTeardownTimeoutMs
          : teardownOptions.timeoutMs
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new TypeError("Teardown timeoutMs must be a finite non-negative number.")
      }
      if (teardownPromise !== undefined) return teardownPromise
      if (disposed || terminated) {
        teardownPromise = Promise.resolve(undefined)
        return teardownPromise
      }

      const surfaceId = broker.surface.id
      const requestId = `teardown-${nextTeardownRequestId++}`
      const target = iframe.contentWindow
      teardownPromise = new Promise<SnapshotValue | undefined>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            if (!disposed && !terminated) {
              emit({
                type: "violation",
                reason: "teardown_timeout",
                detail: `Surface teardown timed out after ${timeoutMs}ms.`,
              })
            }
          } finally {
            disposeMount(undefined)
          }
        }, timeoutMs)
        pendingTeardown = { surfaceId, requestId, timeout, resolve }
        if (target === null) {
          disposeMount(undefined)
          return
        }
        try {
          target.postMessage(
            {
              channel: protocolChannel,
              type: "teardown_request",
              surfaceId,
              requestId,
              ...(reason === undefined ? {} : { reason }),
            },
            "*",
          )
        } catch {
          disposeMount(undefined)
        }
      })
      return teardownPromise
    },
    dispose() {
      disposeMount(undefined)
    },
  }
}
