import type {
  CapabilityCall,
  CapabilityDescriptor,
  CapabilityErrorCode,
  CapabilityResult,
  Surface,
} from "../types.js"
import { normalizeResultTarget, resultStateFromCapabilityResult } from "./result-routing.js"
export {
  defaultResultTarget,
  normalizeResultTarget,
  resultStateFromCapabilityResult,
  type ResultState,
  type ResultStatus,
} from "./result-routing.js"

const protocolChannel = "genui/dom/0"
const defaultMaxHeight = 1_200

export type SurfaceViolationReason =
  | "unknown_channel"
  | "bad_message"
  | "surface_mismatch"
  | "ungranted_call"

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

export interface MountSurfaceOptions {
  readonly transport: (call: CapabilityCall) => Promise<CapabilityResult>
  readonly approve?: (
    descriptor: CapabilityDescriptor,
    call: CapabilityCall,
  ) => boolean | Promise<boolean>
  readonly onEvent?: (event: SurfaceEvent) => void
  readonly maxHeight?: number
}

export interface SurfaceInstance {
  readonly surface: Surface
  update(surface: Surface): void
  dispose(): void
}

interface BaseSandboxMessage {
  readonly channel: string
  readonly surfaceId: string
}

interface CapabilitySandboxMessage extends BaseSandboxMessage {
  readonly type: "capability"
  readonly callId: string
  readonly capability: string
  readonly input: unknown
  readonly target?: string
}

interface ResizeSandboxMessage extends BaseSandboxMessage {
  readonly type: "resize"
  readonly height: number
}

interface LinkSandboxMessage extends BaseSandboxMessage {
  readonly type: "link"
  readonly href: string
}

type SandboxMessage = CapabilitySandboxMessage | ResizeSandboxMessage | LinkSandboxMessage

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const parseSandboxMessage = (value: unknown): SandboxMessage | undefined => {
  if (!isRecord(value)) return undefined
  if (value.channel !== protocolChannel) return undefined
  if (typeof value.surfaceId !== "string" || typeof value.type !== "string") return undefined

  if (value.type === "resize") {
    return typeof value.height === "number"
      ? {
          channel: protocolChannel,
          type: "resize",
          surfaceId: value.surfaceId,
          height: value.height,
        }
      : undefined
  }

  if (value.type === "link") {
    return typeof value.href === "string"
      ? { channel: protocolChannel, type: "link", surfaceId: value.surfaceId, href: value.href }
      : undefined
  }

  if (value.type === "capability") {
    return typeof value.callId === "string" && typeof value.capability === "string"
      ? {
          channel: protocolChannel,
          type: "capability",
          surfaceId: value.surfaceId,
          callId: value.callId,
          capability: value.capability,
          input: value.input,
          target: typeof value.target === "string" ? value.target : undefined,
        }
      : undefined
  }

  return undefined
}

const capabilityError = (code: CapabilityErrorCode, message: string): CapabilityResult => ({
  ok: false,
  error: { code, message },
})

const clampHeight = (height: number, maxHeight: number): number =>
  Math.max(0, Math.min(Math.ceil(height), maxHeight))

const escapeScriptJson = (value: string): string =>
  JSON.stringify(value).replaceAll("</script", "<\\/script")

const sandboxBridgeScript = (surfaceId: string): string => `
(() => {
  const channel = ${escapeScriptJson(protocolChannel)};
  const surfaceId = ${escapeScriptJson(surfaceId)};
  const post = (message) => parent.postMessage({ channel, surfaceId, ...message }, "*");

  const reportHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    post({ type: "resize", height: Math.max(root.scrollHeight, body ? body.scrollHeight : 0) });
  };

  addEventListener("load", reportHeight);
  if ("ResizeObserver" in window) new ResizeObserver(reportHeight).observe(document.body);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[href]");
    if (link === null) return;
    event.preventDefault();
    post({ type: "link", href: link.href });
  });

  addEventListener("message", (event) => {
    const message = event.data;
    if (message?.channel !== channel || message?.surfaceId !== surfaceId) return;
    if (message.type !== "result") return;
    window.__genuiResults = window.__genuiResults || {};
    window.__genuiResults[message.target] = message.state;
  });
})();
`

const surfaceDocument = (surface: Surface): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>${surface.html}<script>${sandboxBridgeScript(surface.id)}</script></body>
</html>`

/** Mount a generated surface into a sandboxed iframe and broker its capability calls. */
export const mountSurface = (
  element: Element,
  surface: Surface,
  options: MountSurfaceOptions,
): SurfaceInstance => {
  const ownerDocument = element.ownerDocument
  let currentSurface = surface
  let disposed = false

  const iframe = ownerDocument.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.setAttribute("referrerpolicy", "no-referrer")
  iframe.style.border = "0"
  iframe.style.display = "block"
  iframe.style.width = "100%"
  iframe.srcdoc = surfaceDocument(currentSurface)

  element.replaceChildren(iframe)

  const emit = (event: SurfaceEvent): void => options.onEvent?.(event)

  const postResult = (
    surfaceId: string,
    callId: string,
    capability: string,
    target: string,
    result: CapabilityResult,
  ): void => {
    if (disposed || currentSurface.id !== surfaceId) return

    iframe.contentWindow?.postMessage(
      {
        channel: protocolChannel,
        type: "result",
        surfaceId,
        callId,
        capability,
        target,
        result,
        state: resultStateFromCapabilityResult(result),
      },
      "*",
    )
    emit({ type: "result", callId, capability, target, result })
  }

  const executeCapability = async (message: CapabilitySandboxMessage): Promise<void> => {
    const surfaceId = currentSurface.id
    const target = normalizeResultTarget(message.target, message.capability)
    const descriptor = currentSurface.grant.capabilities.find(
      (capability) => capability.name === message.capability,
    )
    const call: CapabilityCall = {
      surfaceId: currentSurface.id,
      callId: message.callId,
      capability: message.capability,
      input: message.input,
    }

    if (descriptor === undefined) {
      emit({
        type: "violation",
        reason: "ungranted_call",
        detail: `Capability is not granted: ${message.capability}`,
      })
      postResult(
        surfaceId,
        message.callId,
        message.capability,
        target,
        capabilityError("not_granted", "Capability is not granted to this surface."),
      )
      return
    }

    emit({ type: "call", call, target })

    if (descriptor.requiresApproval) {
      const approved = await options.approve?.(descriptor, call)
      if (approved !== true) {
        postResult(
          surfaceId,
          message.callId,
          message.capability,
          target,
          capabilityError("approval_denied", "Capability was denied."),
        )
        return
      }
    }

    try {
      postResult(
        surfaceId,
        message.callId,
        message.capability,
        target,
        await options.transport(call),
      )
    } catch {
      postResult(
        surfaceId,
        message.callId,
        message.capability,
        target,
        capabilityError("execution_failed", "Capability failed."),
      )
    }
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== iframe.contentWindow) return
    if (isRecord(event.data) && event.data.channel !== protocolChannel) {
      emit({ type: "violation", reason: "unknown_channel" })
      return
    }

    const message = parseSandboxMessage(event.data)
    if (message === undefined) {
      emit({ type: "violation", reason: "bad_message" })
      return
    }

    if (message.surfaceId !== currentSurface.id) {
      emit({ type: "violation", reason: "surface_mismatch" })
      return
    }

    if (message.type === "resize") {
      const height = clampHeight(message.height, options.maxHeight ?? defaultMaxHeight)
      iframe.style.height = `${height}px`
      emit({ type: "resize", height })
      return
    }

    if (message.type === "link") {
      emit({ type: "link", href: message.href })
      return
    }

    void executeCapability(message)
  }

  ownerDocument.defaultView?.addEventListener("message", handleMessage)

  return {
    get surface() {
      return currentSurface
    },
    update(nextSurface) {
      currentSurface = nextSurface
      iframe.srcdoc = surfaceDocument(currentSurface)
    },
    dispose() {
      disposed = true
      ownerDocument.defaultView?.removeEventListener("message", handleMessage)
      iframe.remove()
    },
  }
}
