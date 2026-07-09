import { codeBootstrapScript } from "../code/bootstrap.js"
import {
  codeDialect,
  type Action,
  type ActionCall,
  type ActionResult,
  type Surface,
} from "../types.js"
import { protocolChannel } from "./protocol.js"
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
  /** Best-effort host UX confirmation over the raw sandbox call. */
  readonly confirm?: (action: Action, call: ActionCall) => boolean | Promise<boolean>
  readonly imagePolicy?: ImagePolicy
  readonly maxHeight?: number
  readonly onEvent?: (event: SurfaceEvent) => void
}

export type ImagePolicy = "none" | "data" | "https" | "https-and-data"

export interface Mounted {
  readonly surface: Surface
  replace(surface: Surface): Promise<void>
  dispose(): void
}

const imageSourcePolicy = (policy: ImagePolicy): string => {
  if (policy === "data") return "data:"
  if (policy === "https") return "https:"
  if (policy === "https-and-data") return "https: data:"
  return "'none'"
}

const surfaceDocument = (surface: Surface, imagePolicy: ImagePolicy): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${imageSourcePolicy(imagePolicy)}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body><script>${codeBootstrapScript({ channel: protocolChannel, surfaceId: surface.id })}</script>${surface.content}</body>
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
  let disposed = false
  let terminated = false
  let expectedDocumentLoads = 0
  let errorElement: Element | undefined

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

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || terminated || event.source !== iframe.contentWindow) return
    applyTask(broker.handleSandboxMessage(event.data))
  }

  const postGrant = (): void => {
    const current = broker.surface
    iframe.contentWindow?.postMessage(
      {
        channel: protocolChannel,
        type: "grant",
        surfaceId: current.id,
        actions: current.grant.actions,
      },
      "*",
    )
  }

  const handleLoad = (): void => {
    if (disposed || terminated) return
    if (expectedDocumentLoads > 0) {
      expectedDocumentLoads -= 1
      postGrant()
      return
    }

    emit({ type: "violation", reason: "navigation" })
    terminated = true
    broker.dispose()
    ownerDocument.defaultView?.removeEventListener("message", handleMessage)
    iframe.removeEventListener("load", handleLoad)

    const error = ownerDocument.createElement("div")
    error.setAttribute("role", "alert")
    error.textContent = "Generated UI navigation blocked."
    errorElement = error
    element.replaceChildren(error)
  }

  const setDocument = (nextSurface: Surface): void => {
    expectedDocumentLoads += 1
    iframe.srcdoc = surfaceDocument(nextSurface, imagePolicy)
  }

  ownerDocument.defaultView?.addEventListener("message", handleMessage)
  iframe.addEventListener("load", handleLoad)
  setDocument(broker.surface)
  element.replaceChildren(iframe)

  return {
    get surface() {
      return broker.surface
    },
    replace(nextSurface) {
      assertSupportedSurface(nextSurface)
      if (disposed || terminated) return Promise.resolve()
      broker.replace(nextSurface)
      setDocument(nextSurface)
      return Promise.resolve()
    },
    dispose() {
      if (disposed) return
      disposed = true
      broker.dispose()
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.removeEventListener("load", handleLoad)
      iframe.remove()
      errorElement?.remove()
    },
  }
}
