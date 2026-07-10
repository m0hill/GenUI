import {
  codeDialect,
  type Action,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "@genui/protocol"
import { codeBootstrapScript } from "../code/bootstrap.js"
import { createHeartbeatTripwire, type HeartbeatTripwire } from "./heartbeat-tripwire.js"
import { protocolChannel } from "./protocol.js"
import { parseSandboxMessage, type SnapshotSandboxMessage } from "./sandbox-message-schema.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
  type SurfaceEvent,
  type TransportOptions,
} from "./surface-broker.js"

export type { SurfaceEvent, SurfaceViolationReason, TransportOptions } from "./surface-broker.js"

export interface MountOptions {
  readonly transport: (call: ActionCall, options: TransportOptions) => Promise<ActionResult>
  /** Trusted consent UI using the kernel-rendered canonical action intent. */
  readonly confirm?: (
    action: Action,
    call: ActionCall,
    intent: string,
  ) => boolean | Promise<boolean>
  readonly imagePolicy?: ImagePolicy
  readonly maxHeight?: number
  readonly onEvent?: (event: SurfaceEvent) => void
  readonly snapshot?: SnapshotValue
  readonly snapshotTimeoutMs?: number
}

export type ImagePolicy = "none" | "data" | "https" | "https-and-data"

export type SnapshotValue =
  | null
  | boolean
  | number
  | string
  | readonly SnapshotValue[]
  | { readonly [key: string]: SnapshotValue }

export interface ReplaceOptions {
  readonly snapshot?: SnapshotValue
}

export interface Mounted {
  readonly surface: Surface
  snapshot(): Promise<SnapshotValue | undefined>
  replace(surface: Surface, options?: ReplaceOptions): Promise<void>
  dispose(): void
}

interface PendingSnapshotRequest {
  readonly surfaceId: string
  readonly timeout: ReturnType<typeof setTimeout>
  resolve(snapshot: SnapshotValue | undefined): void
}

const defaultSnapshotTimeoutMs = 1_000

const imageSourcePolicy = (policy: ImagePolicy): string => {
  if (policy === "data") return "data:"
  if (policy === "https") return "https:"
  if (policy === "https-and-data") return "https: data:"
  return "'none'"
}

const normalizeSnapshot = (value: unknown): SnapshotValue | undefined => {
  if (value === undefined) return undefined
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError("Snapshot must be JSON-serializable.")
    return JSON.parse(encoded) as SnapshotValue
  } catch {
    throw new TypeError("Snapshot must be JSON-serializable.")
  }
}

const surfaceDocument = (
  surface: Surface,
  imagePolicy: ImagePolicy,
  restore?: SnapshotValue,
): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${imageSourcePolicy(imagePolicy)}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body><script>${codeBootstrapScript({ channel: protocolChannel, surfaceId: surface.id, actions: surface.grant.actions, ...(restore === undefined ? {} : { restore }) })}</script>${surface.content}</body>
</html>`

const assertSupportedSurface = (surface: Surface): void => {
  if (surface.dialect !== codeDialect) {
    throw new Error(`Unsupported generated UI dialect: ${surface.dialect}`)
  }
}

/** Mount generated code into an isolated iframe and broker its action calls. */
export const mount = (element: Element, surface: Surface, options: MountOptions): Mounted => {
  assertSupportedSurface(surface)
  const ownerDocument = element.ownerDocument
  const imagePolicy = options.imagePolicy ?? "none"
  const initialSnapshot = normalizeSnapshot(options.snapshot)
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
  let replacementQueue = Promise.resolve()
  let errorElement: Element | undefined
  let heartbeatTripwire: HeartbeatTripwire | undefined
  let intersectionObserver: IntersectionObserver | undefined
  const pendingSnapshots = new Map<string, PendingSnapshotRequest>()

  const broker = createSurfaceBroker(surface, {
    transport: options.transport,
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

  const terminate = (reason: "navigation" | "unresponsive", message: string): void => {
    if (disposed || terminated) return
    terminated = true
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
    finishSnapshotRequest(
      message.requestId,
      message.ok ? normalizeSnapshot(message.value) : undefined,
    )
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || terminated || event.source !== iframe.contentWindow) return
    const parsed = parseSandboxMessage(event.data)
    if (parsed.ok && parsed.value.type === "heartbeat") {
      if (parsed.value.surfaceId === broker.surface.id) heartbeatTripwire?.heartbeat()
      return
    }
    if (parsed.ok && parsed.value.type === "snapshot") {
      handleSnapshotMessage(parsed.value)
      return
    }
    applyTask(broker.handleSandboxMessage(event.data))
  }

  const handleLoad = (): void => {
    if (disposed || terminated) return
    if (expectedDocumentLoads > 0) {
      expectedDocumentLoads -= 1
      return
    }

    terminate("navigation", "Generated UI navigation blocked.")
  }

  const setDocument = (nextSurface: Surface, restore?: SnapshotValue): void => {
    heartbeatTripwire?.reset()
    expectedDocumentLoads += 1
    iframe.srcdoc = surfaceDocument(nextSurface, imagePolicy, restore)
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
      const explicitSnapshot = normalizeSnapshot(replaceOptions.snapshot)
      const replacement = replacementQueue.then(async () => {
        if (disposed || terminated) return
        const current = broker.surface
        const restore =
          explicitSnapshot !== undefined
            ? explicitSnapshot
            : nextSurface.id === current.id
              ? await requestSnapshot(current.id)
              : undefined
        if (disposed || terminated) return
        broker.replace(nextSurface)
        setDocument(nextSurface, restore)
      })
      replacementQueue = replacement.catch(() => undefined)
      return replacement
    },
    dispose() {
      if (disposed) return
      disposed = true
      broker.dispose()
      finishPendingSnapshots()
      stopMonitoring()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.removeEventListener("load", handleLoad)
      iframe.remove()
      errorElement?.remove()
    },
  }
}
