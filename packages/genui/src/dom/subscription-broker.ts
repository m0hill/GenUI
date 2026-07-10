import {
  parseSubscriptionDelivery,
  parseSubscriptionError,
  subscriptionEventByteLimit,
  type SubscriptionError,
  type SubscriptionErrorCode,
  type SubscriptionRequest,
  type Surface,
} from "../protocol/index.js"
import { protocolChannel } from "./protocol.js"
import type { SubscriptionSandboxMessage } from "./sandbox-message-schema.js"
import type { SubscriptionCloseReason, SurfaceEvent } from "./surface-events.js"

// Subscription input follows the kernel's established 64 KiB action-input boundary.
const subscriptionInputByteLimit = 64 * 1_024
const maxActiveSubscriptions = 4
const maxDeliveriesPerSecond = 10
const acknowledgmentTimeoutMs = 5_000
// Must remain aligned with the generated bootstrap's bounded host error parser.
const maxSubscriptionErrorMessageLength = 2_048

export interface SubscriptionTransportOptions {
  readonly signal: AbortSignal
}

export interface SubscriptionTransportResult {
  readonly events: AsyncIterable<unknown>
}

export type SubscriptionTransport = (
  request: SubscriptionRequest,
  options: SubscriptionTransportOptions,
) => Promise<SubscriptionTransportResult>

/** Stable expected failure thrown by a host adapter before a subscription opens. */
export class SubscriptionTransportError extends Error {
  readonly code: SubscriptionErrorCode

  constructor(code: SubscriptionErrorCode, message: string) {
    super(message)
    this.name = "SubscriptionTransportError"
    this.code = code
  }
}

type SubscriptionResult =
  | { readonly ok: true; readonly reason: "completed" | "unsubscribed" }
  | { readonly ok: false; readonly error: SubscriptionError }

interface SubscriptionOpenedHostMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_opened"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
}

interface SubscriptionEventHostMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_event"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly sequence: number
  readonly event: unknown
}

interface SubscriptionClosedHostMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_closed"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly result: SubscriptionResult
}

export type SubscriptionHostMessage =
  | SubscriptionOpenedHostMessage
  | SubscriptionEventHostMessage
  | SubscriptionClosedHostMessage

interface SubscriptionBrokerOptions {
  readonly subscriptionTransport?: SubscriptionTransport
  post(message: SubscriptionHostMessage): void
  emit(event: SurfaceEvent): void
  readonly now?: () => number
  readonly schedule?: (callback: () => void, delayMs: number) => () => void
}

interface ActiveSubscription {
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly subscription: string
  readonly inputBytes: number
  readonly startedAt: number
  readonly revision: number
  readonly controller: AbortController
  iterator?: ParsedAsyncIterator
  cancelAcknowledgmentTimeout?: () => void
  awaitingSequence?: number
  expectedSequence: number
  eventCount: number
  payloadBytes: number
  pumping: boolean
}

interface ParsedAsyncIterator {
  next(): unknown
  return?(): unknown
}

export interface SubscriptionBroker {
  handleSandboxMessage(message: SubscriptionSandboxMessage): void
  replace(surface: Surface, documentId: string): void
  dispose(reason?: "disposed" | "terminated"): void
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isObjectLike = (value: unknown): value is object | ((...args: never[]) => unknown) =>
  (typeof value === "object" && value !== null) || typeof value === "function"

const exactKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => keys.includes(key))

const normalizeJson = (
  value: unknown,
): { readonly bytes: number; readonly value: unknown } | undefined => {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined
      ? undefined
      : { bytes: new TextEncoder().encode(encoded).byteLength, value: JSON.parse(encoded) }
  } catch {
    return undefined
  }
}

const encodedBytes = (value: unknown): number | undefined => normalizeJson(value)?.bytes

const parsedIterator = (value: unknown): ParsedAsyncIterator | undefined => {
  if (!isRecord(value) || typeof value.next !== "function") return undefined
  const target = value
  const next = value.next
  const returnMethod = typeof value.return === "function" ? value.return : undefined
  return {
    next: () => Reflect.apply(next, target, []),
    ...(returnMethod === undefined
      ? {}
      : { return: () => Reflect.apply(returnMethod, target, []) }),
  }
}

const failure = (code: SubscriptionErrorCode, message: string): SubscriptionResult => ({
  ok: false,
  error: { code, message },
})

const boundedSubscriptionError = (error: SubscriptionError): SubscriptionError => ({
  code: error.code,
  message:
    error.message.length <= maxSubscriptionErrorMessageLength
      ? error.message
      : `${error.message.slice(0, maxSubscriptionErrorMessageLength - 3)}...`,
})

const transportFailure = (error: unknown): SubscriptionError => {
  if (error instanceof SubscriptionTransportError) {
    const parsed = parseSubscriptionError({ code: error.code, message: error.message })
    if (parsed !== undefined) return parsed
  }
  return { code: "transport_failed", message: "Subscription transport failed." }
}

const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timeout = setTimeout(callback, delayMs)
  return () => clearTimeout(timeout)
}

export const createSubscriptionBroker = (
  initialSurface: Surface,
  initialDocumentId: string,
  options: SubscriptionBrokerOptions,
): SubscriptionBroker => {
  let currentSurface = initialSurface
  let currentDocumentId = initialDocumentId
  let revision = 0
  let disposed = false
  const active = new Map<string, ActiveSubscription>()
  const deliveryTimes: number[] = []
  const now = options.now ?? (() => performance.now())
  const schedule = options.schedule ?? defaultSchedule

  const emit = (event: SurfaceEvent): void => {
    try {
      options.emit(event)
    } catch {
      // Observability must not change subscription delivery or cleanup behavior.
    }
  }

  const post = (message: SubscriptionHostMessage): boolean => {
    if (disposed) return false
    try {
      options.post(message)
      return true
    } catch {
      return false
    }
  }

  const isCurrent = (subscription: ActiveSubscription): boolean =>
    !disposed &&
    revision === subscription.revision &&
    currentSurface.id === subscription.surfaceId &&
    currentDocumentId === subscription.documentId &&
    active.get(subscription.subscriptionId) === subscription

  const cleanupIterator = (subscription: ActiveSubscription): void => {
    const iterator = subscription.iterator
    if (iterator?.return === undefined) return
    try {
      void Promise.resolve(iterator.return()).catch(() => undefined)
    } catch {
      // Abort is the primary cancellation path; return() is best effort.
    }
  }

  const close = (
    subscription: ActiveSubscription,
    reason: SubscriptionCloseReason,
    result: SubscriptionResult | undefined,
    postResult: boolean,
  ): void => {
    if (active.get(subscription.subscriptionId) !== subscription) return
    active.delete(subscription.subscriptionId)
    subscription.cancelAcknowledgmentTimeout?.()
    subscription.cancelAcknowledgmentTimeout = undefined
    subscription.controller.abort()
    cleanupIterator(subscription)
    if (postResult && result !== undefined && isCurrentForPost(subscription)) {
      const boundedResult = result.ok
        ? result
        : { ok: false as const, error: boundedSubscriptionError(result.error) }
      post({
        channel: protocolChannel,
        type: "subscription_closed",
        surfaceId: subscription.surfaceId,
        documentId: subscription.documentId,
        subscriptionId: subscription.subscriptionId,
        result: boundedResult,
      })
    }
    emit({
      type: "subscription_closed",
      surfaceId: subscription.surfaceId,
      subscriptionId: subscription.subscriptionId,
      subscription: subscription.subscription,
      reason,
      eventCount: subscription.eventCount,
      payloadBytes: subscription.payloadBytes,
      durationMs: Math.max(0, now() - subscription.startedAt),
    })
  }

  const isCurrentForPost = (subscription: ActiveSubscription): boolean =>
    !disposed &&
    revision === subscription.revision &&
    currentSurface.id === subscription.surfaceId &&
    currentDocumentId === subscription.documentId

  const closeWithError = (subscription: ActiveSubscription, error: SubscriptionError): void => {
    const boundedError = boundedSubscriptionError(error)
    close(subscription, boundedError.code, { ok: false, error: boundedError }, true)
  }

  const deliver = (subscription: ActiveSubscription, delivery: unknown): void => {
    if (!isCurrent(subscription)) return
    const parsed = parseSubscriptionDelivery(delivery)
    if (
      parsed === undefined ||
      parsed.surfaceId !== subscription.surfaceId ||
      parsed.subscriptionId !== subscription.subscriptionId
    ) {
      closeWithError(subscription, {
        code: "invalid_event",
        message: "Subscription transport returned an invalid delivery.",
      })
      return
    }
    if (parsed.type === "error") {
      closeWithError(subscription, parsed.error)
      return
    }
    if (parsed.sequence !== subscription.expectedSequence) {
      closeWithError(subscription, {
        code: "invalid_event",
        message: "Subscription event sequence is invalid.",
      })
      return
    }
    const payloadBytes = encodedBytes(parsed.event)
    if (payloadBytes === undefined) {
      closeWithError(subscription, {
        code: "invalid_event",
        message: "Subscription event is not JSON-serializable.",
      })
      return
    }
    if (payloadBytes > subscriptionEventByteLimit) {
      closeWithError(subscription, {
        code: "event_too_large",
        message: "Subscription event exceeds 64 KiB.",
      })
      return
    }

    const deliveredAt = now()
    const cutoff = deliveredAt - 1_000
    while (deliveryTimes.length > 0 && (deliveryTimes[0] ?? deliveredAt) <= cutoff) {
      deliveryTimes.shift()
    }
    if (deliveryTimes.length >= maxDeliveriesPerSecond) {
      closeWithError(subscription, {
        code: "rate_limited",
        message: "Subscription event rate exceeded 10 events per second.",
      })
      return
    }
    deliveryTimes.push(deliveredAt)
    if (
      subscription.eventCount >= Number.MAX_SAFE_INTEGER ||
      subscription.payloadBytes > Number.MAX_SAFE_INTEGER - payloadBytes
    ) {
      closeWithError(subscription, {
        code: "overflow",
        message: "Subscription delivery counters overflowed.",
      })
      return
    }
    subscription.expectedSequence += 1
    subscription.awaitingSequence = parsed.sequence
    subscription.eventCount += 1
    subscription.payloadBytes += payloadBytes
    try {
      subscription.cancelAcknowledgmentTimeout = schedule(() => {
        if (!isCurrent(subscription) || subscription.awaitingSequence !== parsed.sequence) return
        closeWithError(subscription, {
          code: "ack_timeout",
          message: "Subscription event acknowledgment timed out after 5000ms.",
        })
      }, acknowledgmentTimeoutMs)
    } catch {
      closeWithError(subscription, {
        code: "transport_failed",
        message: "Subscription acknowledgment timer failed.",
      })
      return
    }
    if (
      !post({
        channel: protocolChannel,
        type: "subscription_event",
        surfaceId: subscription.surfaceId,
        documentId: subscription.documentId,
        subscriptionId: subscription.subscriptionId,
        sequence: parsed.sequence,
        event: parsed.event,
      })
    ) {
      closeWithError(subscription, {
        code: "transport_failed",
        message: "Subscription event could not be delivered.",
      })
      return
    }
    emit({
      type: "subscription_event",
      surfaceId: subscription.surfaceId,
      subscriptionId: subscription.subscriptionId,
      subscription: subscription.subscription,
      sequence: parsed.sequence,
      payloadBytes,
    })
  }

  const pump = (subscription: ActiveSubscription): void => {
    if (
      !isCurrent(subscription) ||
      subscription.pumping ||
      subscription.awaitingSequence !== undefined
    ) {
      return
    }
    const iterator = subscription.iterator
    if (iterator === undefined) return
    subscription.pumping = true
    void Promise.resolve()
      .then(() => iterator.next())
      .then((result) => {
        subscription.pumping = false
        if (!isCurrent(subscription)) return
        if (!isRecord(result)) {
          closeWithError(subscription, {
            code: "source_failed",
            message: "Subscription source returned an invalid iterator result.",
          })
          return
        }
        if (result.done === true) {
          close(subscription, "completed", { ok: true, reason: "completed" }, true)
          return
        }
        deliver(subscription, result.value)
      })
      .catch(() => {
        subscription.pumping = false
        if (!isCurrent(subscription)) return
        closeWithError(subscription, {
          code: "source_failed",
          message: "Subscription source failed.",
        })
      })
  }

  const rejectStart = (
    message: Extract<SubscriptionSandboxMessage, { readonly type: "subscription_start" }>,
    error: SubscriptionError,
  ): void => {
    const boundedError = boundedSubscriptionError(error)
    post({
      channel: protocolChannel,
      type: "subscription_closed",
      surfaceId: message.surfaceId,
      documentId: message.documentId,
      subscriptionId: message.subscriptionId,
      result: { ok: false, error: boundedError },
    })
    emit({
      type: "subscription_closed",
      surfaceId: message.surfaceId,
      subscriptionId: message.subscriptionId,
      subscription: message.subscription,
      reason: boundedError.code,
      eventCount: 0,
      payloadBytes: 0,
      durationMs: 0,
    })
  }

  const start = (
    message: Extract<SubscriptionSandboxMessage, { readonly type: "subscription_start" }>,
  ): void => {
    const startRevision = revision
    const isStartCurrent = (): boolean =>
      !disposed &&
      revision === startRevision &&
      currentSurface.id === message.surfaceId &&
      currentDocumentId === message.documentId
    const normalizedInput = normalizeJson(message.input)
    emit({
      type: "subscription_start",
      surfaceId: message.surfaceId,
      subscriptionId: message.subscriptionId,
      subscription: message.subscription,
      inputBytes: normalizedInput?.bytes ?? 0,
    })
    if (!isStartCurrent()) return
    const granted = currentSurface.grant.subscriptions.some(
      (candidate) => candidate.name === message.subscription,
    )
    if (!granted) {
      emit({
        type: "violation",
        reason: "ungranted_subscription",
        detail: `Subscription is not granted: ${message.subscription}`,
      })
      rejectStart(message, {
        code: "not_granted",
        message: "Subscription is not granted to this surface.",
      })
      return
    }
    if (normalizedInput === undefined) {
      rejectStart(message, {
        code: "invalid_input",
        message: "Subscription input must be JSON-serializable.",
      })
      return
    }
    const inputBytes = normalizedInput.bytes
    if (inputBytes > subscriptionInputByteLimit) {
      rejectStart(message, { code: "invalid_input", message: "Subscription input exceeds 64 KiB." })
      return
    }
    if (active.has(message.subscriptionId)) {
      rejectStart(message, { code: "invalid_input", message: "Subscription ID is already active." })
      return
    }
    if (active.size >= maxActiveSubscriptions) {
      rejectStart(message, {
        code: "rate_limited",
        message: "Surface already has four active subscriptions.",
      })
      return
    }
    const transport = options.subscriptionTransport
    if (transport === undefined) {
      rejectStart(message, {
        code: "not_available",
        message: "Subscription transport is not available.",
      })
      return
    }

    const subscription: ActiveSubscription = {
      surfaceId: message.surfaceId,
      documentId: message.documentId,
      subscriptionId: message.subscriptionId,
      subscription: message.subscription,
      inputBytes,
      startedAt: now(),
      revision,
      controller: new AbortController(),
      expectedSequence: 1,
      eventCount: 0,
      payloadBytes: 0,
      pumping: false,
    }
    if (!isStartCurrent()) return
    active.set(subscription.subscriptionId, subscription)
    const request: SubscriptionRequest = {
      surfaceId: message.surfaceId,
      subscriptionId: message.subscriptionId,
      subscription: message.subscription,
      input: normalizedInput.value,
    }
    void Promise.resolve()
      .then(() =>
        isCurrent(subscription)
          ? transport(request, { signal: subscription.controller.signal })
          : undefined,
      )
      .then((result) => {
        if (!isCurrent(subscription)) {
          if (isRecord(result) && isObjectLike(result.events)) {
            const iteratorFactory = Reflect.get(result.events, Symbol.asyncIterator)
            if (typeof iteratorFactory === "function") {
              try {
                const iterator = parsedIterator(Reflect.apply(iteratorFactory, result.events, []))
                if (iterator?.return !== undefined) {
                  void Promise.resolve(iterator.return()).catch(() => undefined)
                }
              } catch {
                // The transport was already aborted; late cleanup is best effort.
              }
            }
          }
          return
        }
        if (!isRecord(result) || !exactKeys(result, ["events"])) {
          closeWithError(subscription, {
            code: "transport_failed",
            message: "Subscription transport returned an invalid result.",
          })
          return
        }
        const events = result.events
        if ((typeof events !== "object" && typeof events !== "function") || events === null) {
          closeWithError(subscription, {
            code: "transport_failed",
            message: "Subscription transport returned an invalid event source.",
          })
          return
        }
        const iteratorFactory = Reflect.get(events, Symbol.asyncIterator)
        if (typeof iteratorFactory !== "function") {
          closeWithError(subscription, {
            code: "transport_failed",
            message: "Subscription transport returned an invalid event source.",
          })
          return
        }
        let iterator: ParsedAsyncIterator | undefined
        try {
          iterator = parsedIterator(Reflect.apply(iteratorFactory, events, []))
        } catch {
          closeWithError(subscription, {
            code: "source_failed",
            message: "Subscription source failed to start.",
          })
          return
        }
        if (iterator === undefined) {
          closeWithError(subscription, {
            code: "source_failed",
            message: "Subscription source returned an invalid iterator.",
          })
          return
        }
        subscription.iterator = iterator
        if (
          !post({
            channel: protocolChannel,
            type: "subscription_opened",
            surfaceId: subscription.surfaceId,
            documentId: subscription.documentId,
            subscriptionId: subscription.subscriptionId,
          })
        ) {
          closeWithError(subscription, {
            code: "transport_failed",
            message: "Subscription could not be opened in the surface.",
          })
          return
        }
        emit({
          type: "subscription_opened",
          surfaceId: subscription.surfaceId,
          subscriptionId: subscription.subscriptionId,
          subscription: subscription.subscription,
        })
        pump(subscription)
      })
      .catch((error: unknown) => {
        if (!isCurrent(subscription)) return
        closeWithError(subscription, transportFailure(error))
      })
  }

  const handleSandboxMessage = (message: SubscriptionSandboxMessage): void => {
    if (
      disposed ||
      message.surfaceId !== currentSurface.id ||
      message.documentId !== currentDocumentId
    ) {
      return
    }
    if (message.type === "subscription_start") {
      start(message)
      return
    }
    const subscription = active.get(message.subscriptionId)
    if (subscription === undefined || !isCurrent(subscription)) return
    if (message.type === "subscription_ack") {
      if (subscription.awaitingSequence !== message.sequence) return
      subscription.cancelAcknowledgmentTimeout?.()
      subscription.cancelAcknowledgmentTimeout = undefined
      subscription.awaitingSequence = undefined
      pump(subscription)
      return
    }
    if (message.type === "subscription_unsubscribe") {
      close(subscription, "unsubscribed", { ok: true, reason: "unsubscribed" }, true)
      return
    }
    close(
      subscription,
      message.reason,
      failure(
        message.reason,
        message.reason === "handler_failed"
          ? "Subscription event handler failed."
          : "Subscription event queue overflowed.",
      ),
      true,
    )
  }

  const cancelAll = (reason: "replaced" | "disposed" | "terminated"): void => {
    for (const subscription of Array.from(active.values())) {
      close(subscription, reason, undefined, false)
    }
  }

  return {
    handleSandboxMessage,
    replace(surface, documentId) {
      if (disposed) return
      cancelAll("replaced")
      revision += 1
      currentSurface = surface
      currentDocumentId = documentId
      deliveryTimes.length = 0
    },
    dispose(reason = "disposed") {
      if (disposed) return
      cancelAll(reason)
      disposed = true
      deliveryTimes.length = 0
    },
  }
}
