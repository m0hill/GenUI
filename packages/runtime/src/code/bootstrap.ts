export interface CodeBootstrapOptions {
  readonly channel: string
  readonly surfaceId: string
  readonly restore?: unknown
}

/** Build the trusted guest bridge injected before model-authored code. */
export const codeBootstrapScript = (options: CodeBootstrapOptions): string => {
  const config = JSON.stringify(options).replaceAll("<", "\\u003c")

  return `(() => {
  "use strict"

  const config = ${config}
  const { channel, surfaceId } = config
  const actions = []
  const pending = new Map()
  let nextCallId = 0
  let snapshotProvider
  let restorePending = Object.prototype.hasOwnProperty.call(config, "restore")

  class GenuiActionError extends Error {
    constructor(code, message) {
      super(message)
      this.name = "GenuiActionError"
      this.code = code
    }
  }

  const post = (message) => window.parent.postMessage({ channel, surfaceId, ...message }, "*")

  const reportGuestError = (message, error) => {
    const text = typeof message === "string" ? message : String(message)
    const stack = typeof error === "object" && error !== null && typeof error.stack === "string"
      ? error.stack
      : undefined
    post({ type: "guest_error", message: text, ...(stack === undefined ? {} : { stack }) })
  }

  const errorMessage = (error) => typeof error === "object" && error !== null &&
      typeof error.message === "string"
    ? error.message
    : String(error)

  window.onerror = (message, _source, _line, _column, error) => {
    reportGuestError(message, error)
  }

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    reportGuestError(errorMessage(reason), reason)
  })

  const snapshot = (provider) => {
    if (typeof provider !== "function") throw new TypeError("Snapshot provider must be a function.")
    snapshotProvider = provider
    if (!restorePending) return

    restorePending = false
    try {
      const restored = provider(config.restore)
      if (restored && typeof restored.then === "function") {
        restored.catch((error) => reportGuestError(errorMessage(error), error))
      }
    } catch (error) {
      reportGuestError(errorMessage(error), error)
    }
  }

  const call = (action, input) => {
    const randomId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : String(Date.now())
    const callId = randomId + ":" + String(++nextCallId)

    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject })
      try {
        post({ callId, action, input })
      } catch {
        pending.delete(callId)
        reject(new GenuiActionError("invalid_input", "Action input could not be sent."))
      }
    })
  }

  window.addEventListener("message", (event) => {
    const message = event.data
    if (typeof message !== "object" || message === null) return
    if (message.channel !== channel || message.surfaceId !== surfaceId) return

    if (message.type === "grant" && Array.isArray(message.actions)) {
      actions.splice(0, actions.length, ...message.actions)
      return
    }

    if (message.type === "snapshot_request" && typeof message.requestId === "string") {
      if (snapshotProvider === undefined) {
        post({ type: "snapshot", requestId: message.requestId, ok: false })
        return
      }

      Promise.resolve()
        .then(() => snapshotProvider())
        .then((value) => {
          const encoded = JSON.stringify(value)
          if (encoded === undefined) throw new TypeError("Snapshot must be JSON-serializable.")
          post({
            type: "snapshot",
            requestId: message.requestId,
            ok: true,
            value: JSON.parse(encoded),
          })
        })
        .catch((error) => {
          reportGuestError(errorMessage(error), error)
          post({ type: "snapshot", requestId: message.requestId, ok: false })
        })
      return
    }

    if (message.type !== "result" || typeof message.callId !== "string") return
    const waiting = pending.get(message.callId)
    if (waiting === undefined) return
    pending.delete(message.callId)

    const result = message.result
    if (typeof result === "object" && result !== null && result.ok === true &&
        Object.prototype.hasOwnProperty.call(result, "value")) {
      waiting.resolve(result.value)
      return
    }

    if (typeof result === "object" && result !== null && result.ok === false &&
        typeof result.error === "object" && result.error !== null &&
        typeof result.error.code === "string" && typeof result.error.message === "string") {
      waiting.reject(new GenuiActionError(result.error.code, result.error.message))
      return
    }

    waiting.reject(new GenuiActionError("execution_failed", "Action returned an invalid result."))
  })

  const reportHeight = () => {
    const bodyHeight = document.body === null ? 0 : document.body.scrollHeight
    const rootHeight = document.documentElement === null ? 0 : document.documentElement.scrollHeight
    post({ type: "resize", height: Math.max(bodyHeight, rootHeight) })
  }

  if (typeof globalThis.ResizeObserver === "function") {
    new ResizeObserver(reportHeight).observe(document.documentElement)
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", reportHeight, { once: true })
  } else {
    queueMicrotask(reportHeight)
  }

  Object.defineProperty(window, "genui", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({ surfaceId, actions, call, snapshot }),
  })
})()`
}
