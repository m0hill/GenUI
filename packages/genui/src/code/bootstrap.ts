import type { Action } from "../protocol/index.js"
import type { GuestHostContext } from "../host-context.js"

interface CodeBootstrapOptions {
  readonly channel: string
  readonly surfaceId: string
  readonly actions: readonly Action[]
  readonly sendMessage: boolean
  readonly openLink: boolean
  readonly updateModelContext: boolean
  readonly hostContext: GuestHostContext
  readonly restore?: unknown
}

/** Runs before untrusted content and installs its only capability bridge. */
export const codeBootstrapScript = (options: CodeBootstrapOptions): string => {
  const config = JSON.stringify(options).replaceAll("<", "\\u003c")

  return `(() => {
  "use strict"

  const config = ${config}
  const { actions, channel, hostContext: initialHostContext, openLink: canOpenLink,
    sendMessage: canSendMessage, surfaceId, updateModelContext: canUpdateModelContext } = config
  const objectFreeze = Object.freeze
  const objectKeys = Object.keys
  const arrayIsArray = Array.isArray
  const numberIsFinite = Number.isFinite
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty)
  const arrayEvery = Function.prototype.call.bind(Array.prototype.every)
  const arraySome = Function.prototype.call.bind(Array.prototype.some)
  const setHas = Function.prototype.call.bind(Set.prototype.has)
  const promiseResolve = Promise.resolve.bind(Promise)
  const canonicalLocales = Intl.getCanonicalLocales.bind(Intl)
  const TrustedDateTimeFormat = Intl.DateTimeFormat
  const capabilities = objectFreeze({
    sendMessage: canSendMessage,
    openLink: canOpenLink,
    updateModelContext: canUpdateModelContext,
  })
  const pending = new Map()
  let nextCallId = 0
  let snapshotProvider
  let teardownHandler
  let hostContextChangeHandler
  let restorePending = hasOwn(config, "restore")
  // Capability payloads use a tighter cap than the kernel's 64 KiB action-input precedent.
  const maxCapabilityPayloadBytes = 16 * 1024
  const maxHostMessageStringLength = 256
  const maxLocaleTimeZoneLength = 128

  const freezeHostContext = (value) => objectFreeze({
    ...value,
    ...(value.containerDimensions === undefined
      ? {}
      : { containerDimensions: objectFreeze({ ...value.containerDimensions }) }),
  })
  let currentHostContext = freezeHostContext(initialHostContext)

  const applyDocumentTheme = (nextTheme) => {
    document.documentElement.setAttribute("data-theme", nextTheme)
    document.documentElement.style.colorScheme = nextTheme
  }

  if (currentHostContext.theme !== undefined) {
    applyDocumentTheme(currentHostContext.theme)
  }

  class GenuiActionError extends Error {
    constructor(code, message) {
      super(message)
      this.name = "GenuiActionError"
      this.code = code
    }
  }

  const post = (message) => window.parent.postMessage({ channel, surfaceId, ...message }, "*")

  const heartbeat = () => post({ type: "heartbeat" })
  heartbeat()
  const heartbeatInterval = window.setInterval(heartbeat, 1000)
  window.addEventListener("pagehide", () => window.clearInterval(heartbeatInterval), { once: true })

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

  const teardown = (handler) => {
    if (typeof handler !== "function") throw new TypeError("Teardown handler must be a function.")
    teardownHandler = handler
  }

  const onHostContextChange = (handler) => {
    if (typeof handler !== "function") {
      throw new TypeError("Host context change handler must be a function.")
    }
    hostContextChangeHandler = handler
  }

  const captureSnapshot = () => promiseResolve()
    .then(() => snapshotProvider())
    .then((value) => {
      const encoded = JSON.stringify(value)
      if (encoded === undefined) throw new TypeError("Snapshot must be JSON-serializable.")
      return JSON.parse(encoded)
    })

  const createCallId = () => {
    const randomId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : String(Date.now())
    return randomId + ":" + String(++nextCallId)
  }

  const call = (action, input) => {
    const callId = createCallId()

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

  const unavailableCapability = () => Promise.reject(
    new GenuiActionError("not_available", "Host capability is not available."),
  )
  const invalidCapabilityInput = () => Promise.reject(
    new GenuiActionError("invalid_input", "Capability input is invalid."),
  )
  const isRecord = (value) => typeof value === "object" && value !== null &&
    !arrayIsArray(value)
  const hostContextKeys = new Set([
    "theme", "containerDimensions", "locale", "timeZone", "platform",
  ])
  const containerDimensionKeys = new Set(["height", "maxHeight", "width", "maxWidth"])
  const hostContextMessageKeys = new Set(["channel", "type", "surfaceId", "context"])
  const hasOnlyKeys = (value, keys) =>
    arrayEvery(objectKeys(value), (key) => setHas(keys, key))
  const isDimensionValue = (value) => typeof value === "number" && numberIsFinite(value) &&
    value >= 0
  const validLocale = (value) => {
    if (typeof value !== "string" || value.length === 0 ||
        value.length > maxLocaleTimeZoneLength) return false
    try {
      canonicalLocales(value)
      return true
    } catch {
      return false
    }
  }
  const validTimeZone = (value) => {
    if (typeof value !== "string" || value.length === 0 ||
        value.length > maxLocaleTimeZoneLength) return false
    try {
      new TrustedDateTimeFormat("en-US", { timeZone: value })
      return true
    } catch {
      return false
    }
  }
  const parseHostContextUpdate = (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, hostContextKeys)) return undefined
    if ((!hasOwn(value, "theme") && value.theme !== undefined) ||
        (!hasOwn(value, "containerDimensions") && value.containerDimensions !== undefined) ||
        (!hasOwn(value, "locale") && value.locale !== undefined) ||
        (!hasOwn(value, "timeZone") && value.timeZone !== undefined) ||
        (!hasOwn(value, "platform") && value.platform !== undefined)) return undefined
    const update = {}

    if (value.theme !== undefined) {
      if (value.theme !== "light" && value.theme !== "dark") return undefined
      update.theme = value.theme
    }
    if (value.containerDimensions !== undefined) {
      const dimensions = value.containerDimensions
      if (!isRecord(dimensions) || !hasOnlyKeys(dimensions, containerDimensionKeys)) {
        return undefined
      }
      const hasHeight = hasOwn(dimensions, "height")
      const hasMaxHeight = hasOwn(dimensions, "maxHeight")
      const hasWidth = hasOwn(dimensions, "width")
      const hasMaxWidth = hasOwn(dimensions, "maxWidth")
      if ((hasHeight && hasMaxHeight) || (hasWidth && hasMaxWidth)) return undefined
      if ((hasHeight && !isDimensionValue(dimensions.height)) ||
          (hasMaxHeight && !isDimensionValue(dimensions.maxHeight)) ||
          (hasWidth && !isDimensionValue(dimensions.width)) ||
          (hasMaxWidth && !isDimensionValue(dimensions.maxWidth))) return undefined
      update.containerDimensions = {
        ...(hasHeight ? { height: dimensions.height } : {}),
        ...(hasMaxHeight ? { maxHeight: dimensions.maxHeight } : {}),
        ...(hasWidth ? { width: dimensions.width } : {}),
        ...(hasMaxWidth ? { maxWidth: dimensions.maxWidth } : {}),
      }
    }
    if (value.locale !== undefined) {
      if (!validLocale(value.locale)) return undefined
      update.locale = value.locale
    }
    if (value.timeZone !== undefined) {
      if (!validTimeZone(value.timeZone)) return undefined
      update.timeZone = value.timeZone
    }
    if (value.platform !== undefined) {
      if (value.platform !== "web" && value.platform !== "desktop" &&
          value.platform !== "mobile") return undefined
      update.platform = value.platform
    }
    return update
  }
  const sameContainerDimensions = (left, right) => {
    if (left === undefined || right === undefined) return left === right
    return left.height === right.height && left.maxHeight === right.maxHeight &&
      left.width === right.width && left.maxWidth === right.maxWidth
  }
  const changesHostContext = (update) => arraySome(objectKeys(update), (key) =>
    key === "containerDimensions"
      ? !sameContainerDimensions(currentHostContext.containerDimensions,
          update.containerDimensions)
      : currentHostContext[key] !== update[key])
  const isModelContextParams = (value) => isRecord(value) &&
    arrayEvery(objectKeys(value), (key) => key === "content" || key === "structuredContent") &&
    (value.content === undefined || typeof value.content === "string") &&
    (value.structuredContent === undefined || isRecord(value.structuredContent))

  const requestCapability = (capability, params) => {
    const callId = createCallId()
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve: () => resolve(), reject })
      try {
        post({ type: "capability_call", callId, capability, params })
      } catch {
        pending.delete(callId)
        reject(new GenuiActionError("invalid_input", "Capability request could not be sent."))
      }
    })
  }

  const sendMessage = canSendMessage
    ? (text) => {
        if (typeof text !== "string" ||
            new TextEncoder().encode(text).byteLength > maxCapabilityPayloadBytes) {
          return invalidCapabilityInput()
        }
        return requestCapability("ui/message", {
          role: "user",
          content: { type: "text", text },
        })
      }
    : unavailableCapability
  const openLink = canOpenLink
    ? (url) => typeof url === "string"
      ? requestCapability("ui/open-link", { url })
      : invalidCapabilityInput()
    : unavailableCapability
  const updateModelContext = canUpdateModelContext
    ? (params) => {
        let encoded
        let normalized
        try {
          if (!isModelContextParams(params)) return invalidCapabilityInput()
          encoded = JSON.stringify(params)
          normalized = JSON.parse(encoded)
          if (!isModelContextParams(normalized)) return invalidCapabilityInput()
        } catch {
          return invalidCapabilityInput()
        }
        if (encoded === undefined ||
            new TextEncoder().encode(encoded).byteLength > maxCapabilityPayloadBytes) {
          return invalidCapabilityInput()
        }
        return requestCapability("ui/update-model-context", normalized)
      }
    : unavailableCapability

  window.addEventListener("message", (event) => {
    if (!event.isTrusted || event.source !== window.parent) return
    const message = event.data
    if (typeof message !== "object" || message === null) return
    if (message.channel !== channel || message.surfaceId !== surfaceId) return

    if (message.type === "host_context_changed") {
      if (!hasOnlyKeys(message, hostContextMessageKeys) ||
          !hasOwn(message, "channel") || !hasOwn(message, "type") ||
          !hasOwn(message, "surfaceId") || !hasOwn(message, "context")) return
      const update = parseHostContextUpdate(message.context)
      if (update === undefined || !changesHostContext(update)) return
      const frozenUpdate = freezeHostContext(update)
      currentHostContext = freezeHostContext({ ...currentHostContext, ...frozenUpdate })
      if (frozenUpdate.theme !== undefined) applyDocumentTheme(frozenUpdate.theme)
      const handler = hostContextChangeHandler
      promiseResolve()
        .then(() => handler?.(frozenUpdate))
        .catch((error) => reportGuestError(errorMessage(error), error))
      return
    }

    if (message.type === "teardown_request" && typeof message.requestId === "string" &&
        message.requestId.length <= maxHostMessageStringLength &&
        (message.reason === undefined ||
          (typeof message.reason === "string" &&
            message.reason.length <= maxHostMessageStringLength))) {
      const teardownRequestId = message.requestId
      const teardownReason = message.reason
      const cleanup = teardownHandler
      promiseResolve()
        .then(() => cleanup?.({ reason: teardownReason }))
        .then(() => {
          if (snapshotProvider === undefined) {
            post({ type: "teardown", requestId: teardownRequestId, ok: true })
            return
          }
          return captureSnapshot().then((value) => {
            post({ type: "teardown", requestId: teardownRequestId, ok: true, value })
          })
        })
        .catch((error) => {
          reportGuestError(errorMessage(error), error)
          post({ type: "teardown", requestId: teardownRequestId, ok: false })
        })
      return
    }

    if (message.type === "snapshot_request" && typeof message.requestId === "string") {
      if (snapshotProvider === undefined) {
        post({ type: "snapshot", requestId: message.requestId, ok: false })
        return
      }

      captureSnapshot()
        .then((value) => {
          post({
            type: "snapshot",
            requestId: message.requestId,
            ok: true,
            value,
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
        hasOwn(result, "value")) {
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

  let resizeObserver
  let resizeFrame
  let lastWidth
  let lastHeight
  let resizeStopped = false
  const reportSize = () => {
    if (resizeStopped || resizeFrame !== undefined) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (resizeStopped) return
      const html = document.documentElement
      const originalHeight = html.style.height
      let height
      try {
        html.style.height = "max-content"
        height = Math.max(0, Math.ceil(html.getBoundingClientRect().height))
      } finally {
        html.style.height = originalHeight
      }
      const width = Math.max(0, Math.ceil(window.innerWidth))
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      post({ type: "resize", width, height })
    })
  }
  const startSizeObservation = () => {
    if (resizeStopped) return
    reportSize()
    if (typeof globalThis.ResizeObserver !== "function") return
    resizeObserver = new ResizeObserver(reportSize)
    resizeObserver.observe(document.documentElement)
    resizeObserver.observe(document.body)
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startSizeObservation, { once: true })
  } else {
    queueMicrotask(startSizeObservation)
  }
  window.addEventListener("pagehide", () => {
    resizeStopped = true
    resizeObserver?.disconnect()
    if (resizeFrame !== undefined) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = undefined
    }
  }, { once: true })

  const genui = {
    surfaceId,
    actions,
    capabilities,
    call,
    sendMessage,
    openLink,
    updateModelContext,
    snapshot,
    teardown,
    onHostContextChange,
  }
  Object.defineProperty(genui, "hostContext", {
    configurable: false,
    enumerable: true,
    get: () => currentHostContext,
  })
  Object.defineProperty(window, "genui", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: objectFreeze(genui),
  })
})()`
}
