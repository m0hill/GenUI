import {
  genuiDialect,
  type ActionCall,
  type ActionResult,
  type ExecuteOptions,
  type Surface,
} from "../types.js"
import { emptySurfaceSnapshot, protocolChannel, type SurfaceSnapshot } from "./protocol.js"
import { sandboxBridgeScript } from "./sandbox-bridge.js"
import { parseSnapshotSandboxMessage } from "./sandbox-message-schema.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
  type SurfaceEvent,
  type TransportOptions,
} from "./surface-broker.js"
export type { SurfaceEvent, SurfaceViolationReason, TransportOptions } from "./surface-broker.js"
export type { SurfaceSnapshot } from "./protocol.js"

export interface MountOptions {
  readonly transport: (call: ActionCall, options: TransportOptions) => Promise<ActionResult>
  readonly confirm?: NonNullable<ExecuteOptions["approve"]>
  readonly imagePolicy?: ImagePolicy
  readonly maxHeight?: number
  readonly onEvent?: (event: SurfaceEvent) => void
  readonly snapshot?: SurfaceSnapshot
  readonly snapshotTimeoutMs?: number
}

export type ImagePolicy = "none" | "data" | "https" | "https-and-data"

export interface ReplaceOptions {
  readonly snapshot?: SurfaceSnapshot
}

export interface Mounted {
  readonly surface: Surface
  snapshot(): Promise<SurfaceSnapshot | undefined>
  replace(surface: Surface, options?: ReplaceOptions): Promise<void>
  dispose(): void
}

interface PendingSnapshotRequest {
  readonly surfaceId: string
  readonly timeout: ReturnType<typeof setTimeout>
  resolve(snapshot: SurfaceSnapshot | undefined): void
}

const defaultSnapshotTimeoutMs = 1_000

const imageSourcePolicy = (policy: ImagePolicy): string => {
  if (policy === "data") return "data:"
  if (policy === "https") return "https:"
  if (policy === "https-and-data") return "https: data:"
  return "'none'"
}

const surfaceDocument = (
  surface: Surface,
  imagePolicy: ImagePolicy,
  snapshot?: SurfaceSnapshot,
): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${imageSourcePolicy(imagePolicy)}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>${surface.content}<script>${sandboxBridgeScript(surface.id, snapshot)}</script></body>
</html>`

const assertSupportedSurfaceDialect = (surface: Surface): void => {
  if (surface.dialect !== genuiDialect) {
    throw new Error(`Unsupported generated UI dialect: ${surface.dialect}`)
  }
}

/** Mount a generated surface into a sandboxed iframe and broker its action calls. */
export const mount = (element: Element, surface: Surface, options: MountOptions): Mounted => {
  assertSupportedSurfaceDialect(surface)

  const ownerDocument = element.ownerDocument
  let disposed = false
  let nextSnapshotRequestId = 1
  let replacementQueue = Promise.resolve()
  const snapshotTimeoutMs =
    typeof options.snapshotTimeoutMs === "number" &&
    Number.isFinite(options.snapshotTimeoutMs) &&
    options.snapshotTimeoutMs >= 0
      ? options.snapshotTimeoutMs
      : defaultSnapshotTimeoutMs
  const imagePolicy = options.imagePolicy ?? "none"
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
    if (disposed) return

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
    if (task.pending !== undefined)
      void task.pending.then((effects) => effects.forEach(applyEffect))
  }

  const finishSnapshotRequest = (
    requestId: string,
    snapshot: SurfaceSnapshot | undefined,
  ): void => {
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

  const requestSnapshot = (surfaceId: string): Promise<SurfaceSnapshot | undefined> => {
    const target = iframe.contentWindow
    if (disposed || target === null) return Promise.resolve(undefined)

    const requestId = `snapshot-${nextSnapshotRequestId++}`
    return new Promise<SurfaceSnapshot | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        if (!disposed) {
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
        {
          channel: protocolChannel,
          type: "snapshot_request",
          surfaceId,
          requestId,
        },
        "*",
      )
    })
  }

  const handleSnapshotMessage = (data: unknown): boolean => {
    const message = parseSnapshotSandboxMessage(data)
    if (message === undefined) return false

    const pending = pendingSnapshots.get(message.requestId)
    if (pending === undefined) return true
    if (pending.surfaceId !== message.surfaceId) {
      finishSnapshotRequest(message.requestId, undefined)
      return true
    }

    finishSnapshotRequest(message.requestId, message.snapshot)
    return true
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== iframe.contentWindow) return
    if (handleSnapshotMessage(event.data)) return
    applyTask(broker.handleSandboxMessage(event.data))
  }

  ownerDocument.defaultView?.addEventListener("message", handleMessage)
  iframe.srcdoc = surfaceDocument(
    broker.surface,
    imagePolicy,
    options.snapshot ?? emptySurfaceSnapshot(),
  )

  element.replaceChildren(iframe)

  return {
    get surface() {
      return broker.surface
    },
    snapshot() {
      return requestSnapshot(broker.surface.id)
    },
    replace(nextSurface, replaceOptions = {}) {
      assertSupportedSurfaceDialect(nextSurface)
      const replacement = replacementQueue.then(async () => {
        if (disposed) return

        const currentSurface = broker.surface
        const snapshot =
          replaceOptions.snapshot !== undefined
            ? replaceOptions.snapshot
            : nextSurface.id === currentSurface.id
              ? await requestSnapshot(currentSurface.id)
              : undefined

        if (disposed) return
        broker.replace(nextSurface)
        iframe.srcdoc = surfaceDocument(
          broker.surface,
          imagePolicy,
          snapshot ?? emptySurfaceSnapshot(),
        )
      })
      replacementQueue = replacement.catch(() => undefined)
      return replacement
    },
    dispose() {
      disposed = true
      broker.dispose()
      finishPendingSnapshots()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.remove()
    },
  }
}
