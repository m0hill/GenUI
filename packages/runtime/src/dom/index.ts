import {
  genuiDialect,
  type ActionCall,
  type ActionResult,
  type ExecuteOptions,
  type Surface,
} from "../types.js"
import { sandboxBridgeScript } from "./sandbox-bridge.js"
import {
  createSurfaceBroker,
  type SurfaceBrokerEffect,
  type SurfaceBrokerTask,
  type SurfaceEvent,
  type SurfaceTransportOptions,
} from "./surface-broker.js"
export type {
  SurfaceEvent,
  SurfaceTransportOptions,
  SurfaceViolationReason,
} from "./surface-broker.js"

export interface MountOptions {
  readonly transport: (call: ActionCall, options: SurfaceTransportOptions) => Promise<ActionResult>
  readonly confirm?: NonNullable<ExecuteOptions["approve"]>
  readonly maxHeight?: number
  readonly onEvent?: (event: SurfaceEvent) => void
}

export interface Mounted {
  readonly surface: Surface
  replace(surface: Surface): void
  dispose(): void
}

const surfaceDocument = (surface: Surface): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>${surface.html}<script>${sandboxBridgeScript(surface.id)}</script></body>
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
  iframe.srcdoc = surfaceDocument(broker.surface)

  element.replaceChildren(iframe)

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

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== iframe.contentWindow) return
    applyTask(broker.handleSandboxMessage(event.data))
  }

  ownerDocument.defaultView?.addEventListener("message", handleMessage)

  return {
    get surface() {
      return broker.surface
    },
    replace(nextSurface) {
      assertSupportedSurfaceDialect(nextSurface)
      broker.replace(nextSurface)
      iframe.srcdoc = surfaceDocument(broker.surface)
    },
    dispose() {
      disposed = true
      broker.dispose()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.remove()
    },
  }
}
