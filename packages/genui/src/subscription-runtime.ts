import {
  subscriptionEventByteLimit,
  subscriptionOpenError,
  type MaybePromise,
  type SubscriptionDelivery,
  type SubscriptionError,
  type SubscriptionErrorCode,
  type SubscriptionOpenResult,
  type SubscriptionRequest,
  type SurfaceRecord,
} from "./protocol/index.js"
import { parseWithSchema } from "./schema.js"
import {
  subscriptionConfidentiality,
  subscriptionPolicy,
  type RegisteredSubscription,
} from "./subscription-projections.js"
import type { SurfaceRuntime } from "./surface-runtime.js"
import type { SubscribeOptions } from "./types.js"

export const maxActiveSubscriptionsPerSurface = 4
export const maxSubscriptionInputBytes = 64 * 1_024

export type SubscriptionErrorPhase =
  | "surface_store"
  | "input_validation"
  | "source_startup"
  | "event_validation"
  | "serialization"
  | "source_iteration"
  | "cleanup"
  | "audit"

/** Trusted-side diagnostic for an internal subscription failure. */
export interface SubscriptionErrorEvent {
  readonly type: "subscription"
  readonly surfaceId: string
  readonly subscriptionId: string
  readonly subject?: string
  readonly subscription: string
  readonly phase: SubscriptionErrorPhase
  readonly cause: unknown
}

export type SubscriptionCloseReason = "completed" | "cancelled" | SubscriptionErrorCode

/** Payload-free trusted subscription lifecycle record. */
export type SubscriptionAuditEntry =
  | {
      readonly type: "start"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subject?: string
      readonly subscription: string
      readonly outcome: "opened" | SubscriptionErrorCode
      readonly at: number
    }
  | {
      readonly type: "event"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subject?: string
      readonly subscription: string
      readonly sequence: number
      readonly payloadBytes: number
      readonly at: number
    }
  | {
      readonly type: "close"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subject?: string
      readonly subscription: string
      readonly reason: SubscriptionCloseReason
      readonly eventCount: number
      readonly payloadBytes: number
      readonly durationMs: number
      readonly at: number
    }

interface CreateSubscriptionRuntimeOptions<Ctx> {
  readonly byName: ReadonlyMap<string, RegisteredSubscription<Ctx>>
  readonly surfaceRuntime: Pick<SurfaceRuntime, "getRecord" | "revoke">
  readonly onSubscription?: (entry: SubscriptionAuditEntry) => MaybePromise<void>
  readonly onError?: (event: SubscriptionErrorEvent) => MaybePromise<void>
}

export interface SubscriptionRuntime<Ctx> {
  open(
    request: SubscriptionRequest,
    ctx: Ctx,
    options?: SubscribeOptions,
  ): Promise<SubscriptionOpenResult>
  beginSurfaceRevocation(surfaceId: string): {
    finish(outcome: "succeeded" | "failed"): void
  }
}

type ActiveAbortReason = "cancelled" | "expired" | "revoked" | SubscriptionErrorCode

interface ActiveSubscription {
  readonly request: SubscriptionRequest
  readonly subject: string | undefined
  readonly controller: AbortController
  readonly abortPromise: Promise<ActiveAbortReason>
  readonly startedAt: number
  resolveAbort(reason: ActiveAbortReason): void
  iterator: AsyncIterator<unknown> | undefined
  expiryTimer: ReturnType<typeof setTimeout> | undefined
  removeExternalAbort: (() => void) | undefined
  opened: boolean
  closed: boolean
  abortReason: ActiveAbortReason | undefined
  eventCount: number
  payloadBytes: number
}

interface PendingSubscriptionOpen {
  readonly surfaceId: string
  revoked: boolean
}

interface SurfaceRevocationState {
  readonly tickets: Set<object>
  succeeded: boolean
}

type AuthorizationResult<Ctx> =
  | {
      readonly ok: true
      readonly definition: RegisteredSubscription<Ctx>["definition"]
      readonly record: SurfaceRecord
    }
  | { readonly ok: false; readonly error: SubscriptionError }

const maxTimerDelayMs = 2_147_483_647

const subscriptionError = (code: SubscriptionErrorCode, message: string): SubscriptionError => ({
  code,
  message,
})

const errorDelivery = (
  active: ActiveSubscription,
  error: SubscriptionError,
): SubscriptionDelivery => ({
  type: "error",
  surfaceId: active.request.surfaceId,
  subscriptionId: active.request.subscriptionId,
  error,
})

const normalizeJson = (
  value: unknown,
): { readonly value: unknown; readonly bytes: number } | undefined => {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) return undefined
    return {
      value: JSON.parse(encoded),
      bytes: new TextEncoder().encode(encoded).byteLength,
    }
  } catch {
    return undefined
  }
}

type ReadIteratorResult =
  | { readonly ok: true; readonly iterator: AsyncIterator<unknown> }
  | { readonly ok: false; readonly cause: unknown }

type ReadIteratorStepResult =
  | { readonly ok: true; readonly done: true }
  | { readonly ok: true; readonly done: false; readonly value: unknown }
  | { readonly ok: false; readonly cause: unknown }

const readAsyncIterator = (value: unknown): ReadIteratorResult => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return {
        ok: false,
        cause: new TypeError("Subscription source must be an AsyncIterable."),
      }
    }
    const method: unknown = Reflect.get(value, Symbol.asyncIterator)
    if (typeof method !== "function") {
      return {
        ok: false,
        cause: new TypeError("Subscription source must be an AsyncIterable."),
      }
    }
    const iterator: unknown = Reflect.apply(method, value, [])
    if (
      (typeof iterator !== "object" && typeof iterator !== "function") ||
      iterator === null ||
      typeof Reflect.get(iterator, "next") !== "function"
    ) {
      return {
        ok: false,
        cause: new TypeError("Subscription source returned an invalid async iterator."),
      }
    }
    // SAFETY: the async-iterator method and returned next method were checked above.
    return { ok: true, iterator: iterator as AsyncIterator<unknown> }
  } catch (cause) {
    return { ok: false, cause }
  }
}

const readIteratorStep = (value: unknown): ReadIteratorStepResult => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return {
        ok: false,
        cause: new TypeError("Subscription source returned an invalid iterator result."),
      }
    }
    const done = Boolean(Reflect.get(value, "done"))
    if (done) return { ok: true, done: true }
    return { ok: true, done: false, value: Reflect.get(value, "value") }
  } catch (cause) {
    return { ok: false, cause }
  }
}

export const createSubscriptionRuntime = <Ctx>({
  byName,
  surfaceRuntime,
  onSubscription,
  onError,
}: CreateSubscriptionRuntimeOptions<Ctx>): SubscriptionRuntime<Ctx> => {
  const activeBySurface = new Map<string, Map<string, ActiveSubscription>>()
  const pendingOpensBySurface = new Map<string, Set<PendingSubscriptionOpen>>()
  const revokingSurfaces = new Map<string, SurfaceRevocationState>()

  const reportError = (
    request: SubscriptionRequest,
    subject: string | undefined,
    phase: SubscriptionErrorPhase,
    cause: unknown,
  ): void => {
    if (onError === undefined) return
    const event: SubscriptionErrorEvent = {
      type: "subscription",
      surfaceId: request.surfaceId,
      subscriptionId: request.subscriptionId,
      ...(subject === undefined ? {} : { subject }),
      subscription: request.subscription,
      phase,
      cause,
    }
    try {
      void Promise.resolve(onError(event)).catch(() => undefined)
    } catch {
      // Diagnostic hook failures are isolated from subscription outcomes.
    }
  }

  const emit = (
    request: SubscriptionRequest,
    subject: string | undefined,
    entry: SubscriptionAuditEntry,
  ): void => {
    if (onSubscription === undefined) return
    try {
      void Promise.resolve(onSubscription(entry)).catch((cause: unknown) => {
        reportError(request, subject, "audit", cause)
      })
    } catch (cause) {
      reportError(request, subject, "audit", cause)
    }
  }

  const emitStart = (
    request: SubscriptionRequest,
    subject: string | undefined,
    outcome: "opened" | SubscriptionErrorCode,
  ): void => {
    emit(request, subject, {
      type: "start",
      surfaceId: request.surfaceId,
      subscriptionId: request.subscriptionId,
      ...(subject === undefined ? {} : { subject }),
      subscription: request.subscription,
      outcome,
      at: Date.now(),
    })
  }

  const removeActive = (active: ActiveSubscription): void => {
    const subscriptions = activeBySurface.get(active.request.surfaceId)
    if (subscriptions?.get(active.request.subscriptionId) !== active) return
    subscriptions.delete(active.request.subscriptionId)
    if (subscriptions.size === 0) activeBySurface.delete(active.request.surfaceId)
  }

  const closeActive = (active: ActiveSubscription, reason: SubscriptionCloseReason): void => {
    if (active.closed) return
    active.closed = true
    if (active.expiryTimer !== undefined) clearTimeout(active.expiryTimer)
    active.removeExternalAbort?.()
    removeActive(active)
    if (!active.opened) return
    const at = Date.now()
    emit(active.request, active.subject, {
      type: "close",
      surfaceId: active.request.surfaceId,
      subscriptionId: active.request.subscriptionId,
      ...(active.subject === undefined ? {} : { subject: active.subject }),
      subscription: active.request.subscription,
      reason,
      eventCount: active.eventCount,
      payloadBytes: active.payloadBytes,
      durationMs: Math.max(0, at - active.startedAt),
      at,
    })
  }

  const returnIterator = (
    iterator: AsyncIterator<unknown>,
    request: SubscriptionRequest,
    subject: string | undefined,
  ): void => {
    let cleanup: unknown
    try {
      const returnMethod: unknown = Reflect.get(iterator, "return")
      if (returnMethod === undefined) return
      if (typeof returnMethod !== "function") {
        reportError(
          request,
          subject,
          "cleanup",
          new TypeError("Subscription iterator return must be a function."),
        )
        return
      }
      cleanup = Reflect.apply(returnMethod, iterator, [])
    } catch (cause) {
      reportError(request, subject, "cleanup", cause)
      return
    }
    try {
      void Promise.resolve(cleanup).catch((cause: unknown) => {
        reportError(request, subject, "cleanup", cause)
      })
    } catch (cause) {
      reportError(request, subject, "cleanup", cause)
    }
  }

  const returnSource = (active: ActiveSubscription): void => {
    if (active.iterator === undefined) return
    returnIterator(active.iterator, active.request, active.subject)
  }

  const abortActive = (active: ActiveSubscription, reason: ActiveAbortReason): void => {
    if (active.abortReason !== undefined) return
    active.abortReason = reason
    active.resolveAbort(reason)
    active.controller.abort(reason)
    returnSource(active)
    closeActive(active, reason)
  }

  const scheduleExpiry = (active: ActiveSubscription, expiresAt: number): void => {
    const schedule = (): void => {
      if (active.closed) return
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) {
        abortActive(active, "expired")
        try {
          void Promise.resolve(surfaceRuntime.revoke(active.request.surfaceId)).catch(
            (cause: unknown) => {
              reportError(active.request, active.subject, "surface_store", cause)
            },
          )
        } catch (cause) {
          reportError(active.request, active.subject, "surface_store", cause)
        }
        return
      }
      active.expiryTimer = setTimeout(schedule, Math.min(remaining, maxTimerDelayMs))
    }
    schedule()
  }

  const authorize = async (
    request: SubscriptionRequest,
    subject: string | undefined,
    live: boolean,
  ): Promise<AuthorizationResult<Ctx>> => {
    let record: SurfaceRecord | undefined
    try {
      record = await surfaceRuntime.getRecord(request.surfaceId)
    } catch (cause) {
      reportError(request, subject, "surface_store", cause)
      return {
        ok: false,
        error: subscriptionError("storage_unavailable", "Surface store is unavailable."),
      }
    }
    if (record === undefined) {
      return {
        ok: false,
        error: subscriptionError(
          live ? "revoked" : "unknown_surface",
          live ? "Subscription authority was revoked." : "Surface is not available.",
        ),
      }
    }
    if (record.subject !== undefined && record.subject !== subject) {
      return {
        ok: false,
        error: subscriptionError("not_granted", "Surface is not granted to this subject."),
      }
    }
    const expiresAt = record.surface.grant.expiresAt
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      try {
        await surfaceRuntime.revoke(request.surfaceId)
      } catch (cause) {
        reportError(request, subject, "surface_store", cause)
        return {
          ok: false,
          error: subscriptionError("storage_unavailable", "Surface store is unavailable."),
        }
      }
      return {
        ok: false,
        error: subscriptionError("expired", "Surface grant has expired."),
      }
    }

    const definition = byName.get(request.subscription)?.definition
    if (definition !== undefined && subscriptionPolicy(definition) === "block") {
      return {
        ok: false,
        error: subscriptionError("blocked", "Subscription is blocked."),
      }
    }
    const granted = record.surface.grant.subscriptions.some(
      (subscription) => subscription.name === request.subscription,
    )
    if (
      definition === undefined ||
      !granted ||
      subscriptionConfidentiality(definition) === "sensitive"
    ) {
      return {
        ok: false,
        error: subscriptionError("not_granted", "Subscription is not granted to this surface."),
      }
    }
    return { ok: true, definition, record }
  }

  const failOpen = (
    request: SubscriptionRequest,
    subject: string | undefined,
    code: SubscriptionErrorCode,
    message: string,
  ): SubscriptionOpenResult => {
    emitStart(request, subject, code)
    return subscriptionOpenError(code, message)
  }

  const reserve = (
    request: SubscriptionRequest,
    subject: string | undefined,
  ): ActiveSubscription | SubscriptionError => {
    let subscriptions = activeBySurface.get(request.surfaceId)
    if (subscriptions?.has(request.subscriptionId)) {
      return subscriptionError("invalid_input", "Subscription ID is already in use.")
    }
    if ((subscriptions?.size ?? 0) >= maxActiveSubscriptionsPerSurface) {
      return subscriptionError("rate_limited", "Surface has too many active subscriptions.")
    }
    if (subscriptions === undefined) {
      subscriptions = new Map()
      activeBySurface.set(request.surfaceId, subscriptions)
    }

    let resolveAbort: ((reason: ActiveAbortReason) => void) | undefined
    const abortPromise = new Promise<ActiveAbortReason>((resolve) => {
      resolveAbort = resolve
    })
    const controller = new AbortController()
    const active: ActiveSubscription = {
      request,
      subject,
      controller,
      abortPromise,
      startedAt: Date.now(),
      resolveAbort(reason) {
        const resolve = resolveAbort
        if (resolve === undefined) return
        resolveAbort = undefined
        resolve(reason)
      },
      iterator: undefined,
      expiryTimer: undefined,
      removeExternalAbort: undefined,
      opened: false,
      closed: false,
      abortReason: undefined,
      eventCount: 0,
      payloadBytes: 0,
    }
    subscriptions.set(request.subscriptionId, active)
    return active
  }

  const registerPendingOpen = (surfaceId: string): PendingSubscriptionOpen => {
    let pending = pendingOpensBySurface.get(surfaceId)
    if (pending === undefined) {
      pending = new Set()
      pendingOpensBySurface.set(surfaceId, pending)
    }
    const open: PendingSubscriptionOpen = {
      surfaceId,
      revoked: revokingSurfaces.has(surfaceId),
    }
    pending.add(open)
    return open
  }

  const finishPendingOpen = (open: PendingSubscriptionOpen): void => {
    const pending = pendingOpensBySurface.get(open.surfaceId)
    if (pending === undefined) return
    pending.delete(open)
    if (pending.size === 0) pendingOpensBySurface.delete(open.surfaceId)
  }

  const terminal = (active: ActiveSubscription, error: SubscriptionError): SubscriptionDelivery => {
    abortActive(active, error.code)
    return errorDelivery(active, error)
  }

  const deliveriesFor = (active: ActiveSubscription): AsyncIterable<SubscriptionDelivery> => {
    const deliveries = (async function* (): AsyncGenerator<SubscriptionDelivery> {
      const iterator = active.iterator
      if (iterator === undefined) return
      try {
        while (true) {
          if (active.abortReason !== undefined) {
            if (active.abortReason === "cancelled") return
            yield errorDelivery(
              active,
              subscriptionError(active.abortReason, `Subscription ended: ${active.abortReason}.`),
            )
            return
          }
          if (active.closed) return
          const next = Promise.resolve()
            .then(() => iterator.next())
            .then(
              (result) => ({ type: "result" as const, result }),
              (cause: unknown) => ({ type: "error" as const, cause }),
            )
          const outcome = await Promise.race([
            next,
            active.abortPromise.then((reason) => ({ type: "abort" as const, reason })),
          ])
          if (outcome.type === "abort") {
            if (outcome.reason === "cancelled") return
            yield errorDelivery(
              active,
              subscriptionError(outcome.reason, `Subscription ended: ${outcome.reason}.`),
            )
            return
          }
          if (outcome.type === "error") {
            reportError(active.request, active.subject, "source_iteration", outcome.cause)
            yield terminal(
              active,
              subscriptionError("source_failed", "Subscription source failed."),
            )
            return
          }
          const step = readIteratorStep(outcome.result)
          if (!step.ok) {
            reportError(active.request, active.subject, "source_iteration", step.cause)
            yield terminal(
              active,
              subscriptionError("source_failed", "Subscription source failed."),
            )
            return
          }
          if (step.done) {
            closeActive(active, "completed")
            return
          }

          const authorization = await authorize(active.request, active.subject, true)
          if (!authorization.ok) {
            yield terminal(active, authorization.error)
            return
          }
          if (active.abortReason !== undefined) continue
          if (active.closed) return

          const parsed = await parseWithSchema(authorization.definition.event, step.value)
          if (!parsed.ok) {
            reportError(
              active.request,
              active.subject,
              "event_validation",
              Object.hasOwn(parsed, "cause") ? parsed.cause : new Error(parsed.message),
            )
            yield terminal(
              active,
              subscriptionError("invalid_event", "Subscription source produced an invalid event."),
            )
            return
          }
          if (active.abortReason !== undefined) continue
          const normalized = normalizeJson(parsed.value)
          if (normalized === undefined) {
            reportError(
              active.request,
              active.subject,
              "serialization",
              new Error("Subscription event is not JSON-serializable."),
            )
            yield terminal(
              active,
              subscriptionError("invalid_event", "Subscription source produced an invalid event."),
            )
            return
          }
          if (normalized.bytes > subscriptionEventByteLimit) {
            reportError(
              active.request,
              active.subject,
              "serialization",
              new Error("Subscription event exceeds 64 KiB."),
            )
            yield terminal(
              active,
              subscriptionError("event_too_large", "Subscription event exceeds 64 KiB."),
            )
            return
          }
          if (active.eventCount >= Number.MAX_SAFE_INTEGER) {
            yield terminal(
              active,
              subscriptionError("overflow", "Subscription sequence is exhausted."),
            )
            return
          }
          if (active.payloadBytes > Number.MAX_SAFE_INTEGER - normalized.bytes) {
            yield terminal(
              active,
              subscriptionError("overflow", "Subscription byte count is exhausted."),
            )
            return
          }
          if (active.abortReason !== undefined) continue

          const sequence = active.eventCount + 1
          active.eventCount = sequence
          active.payloadBytes += normalized.bytes
          emit(active.request, active.subject, {
            type: "event",
            surfaceId: active.request.surfaceId,
            subscriptionId: active.request.subscriptionId,
            ...(active.subject === undefined ? {} : { subject: active.subject }),
            subscription: active.request.subscription,
            sequence,
            payloadBytes: normalized.bytes,
            at: Date.now(),
          })
          yield {
            type: "event",
            surfaceId: active.request.surfaceId,
            subscriptionId: active.request.subscriptionId,
            sequence,
            event: normalized.value,
          }
        }
      } finally {
        if (!active.closed) abortActive(active, "cancelled")
      }
    })()

    const deliveryIterator: AsyncIterableIterator<SubscriptionDelivery> = {
      [Symbol.asyncIterator]() {
        return deliveryIterator
      },
      next(value?: unknown) {
        return deliveries.next(value)
      },
      return(value?: unknown) {
        if (!active.closed) abortActive(active, "cancelled")
        return deliveries.return(value)
      },
      throw(cause?: unknown) {
        if (!active.closed) abortActive(active, "cancelled")
        return deliveries.throw(cause)
      },
    }
    return deliveryIterator
  }

  const open = async (
    providedRequest: SubscriptionRequest,
    ctx: Ctx,
    options?: SubscribeOptions,
  ): Promise<SubscriptionOpenResult> => {
    const subject = options?.subject
    // Copy before the first await so caller mutation cannot retarget a long-lived stream.
    const normalizedInput = normalizeJson(providedRequest.input)
    const request: SubscriptionRequest = {
      surfaceId: providedRequest.surfaceId,
      subscriptionId: providedRequest.subscriptionId,
      subscription: providedRequest.subscription,
      input: normalizedInput?.value,
    }
    const pendingOpen = registerPendingOpen(request.surfaceId)
    let authorization: Extract<AuthorizationResult<Ctx>, { readonly ok: true }> | undefined
    let active: ActiveSubscription | undefined
    try {
      const authorized = await authorize(request, subject, false)
      if (pendingOpen.revoked) {
        return failOpen(request, subject, "revoked", "Subscription authority was revoked.")
      }
      if (!authorized.ok) {
        return failOpen(request, subject, authorized.error.code, authorized.error.message)
      }

      if (normalizedInput === undefined) {
        return failOpen(
          request,
          subject,
          "invalid_input",
          "Subscription input must be JSON-serializable.",
        )
      }
      if (normalizedInput.bytes > maxSubscriptionInputBytes) {
        return failOpen(request, subject, "invalid_input", "Subscription input exceeds 64 KiB.")
      }

      const reserved = reserve(request, subject)
      if ("code" in reserved) {
        return failOpen(request, subject, reserved.code, reserved.message)
      }
      authorization = authorized
      active = reserved
    } finally {
      finishPendingOpen(pendingOpen)
    }
    if (authorization === undefined || active === undefined) {
      throw new Error("Subscription open did not produce an active authorization.")
    }
    const expiresAt = authorization.record.surface.grant.expiresAt
    if (expiresAt !== undefined) scheduleExpiry(active, expiresAt)

    const externalSignal = options?.signal
    if (externalSignal !== undefined) {
      const onAbort = (): void => abortActive(active, "cancelled")
      if (externalSignal.aborted) onAbort()
      else {
        externalSignal.addEventListener("abort", onAbort, { once: true })
        active.removeExternalAbort = () => externalSignal.removeEventListener("abort", onAbort)
      }
    }
    if (active.closed) {
      return failOpen(request, subject, "source_failed", "Subscription was cancelled.")
    }

    const input = await parseWithSchema(authorization.definition.input, normalizedInput.value)
    if (!input.ok) {
      if (Object.hasOwn(input, "cause")) {
        reportError(request, subject, "input_validation", input.cause)
      }
      abortActive(active, "invalid_input")
      return failOpen(request, subject, "invalid_input", input.message)
    }
    if (active.abortReason !== undefined) {
      const code =
        active.abortReason === "expired" || active.abortReason === "revoked"
          ? active.abortReason
          : "source_failed"
      return failOpen(request, subject, code, "Subscription was cancelled before opening.")
    }

    let source: AsyncIterable<unknown>
    try {
      const startup = Promise.resolve(
        authorization.definition.subscribe(ctx, input.value, {
          signal: active.controller.signal,
        }),
      ).then(
        (value) => ({ type: "source" as const, value }),
        (cause: unknown) => ({ type: "error" as const, cause }),
      )
      const outcome = await Promise.race([
        startup,
        active.abortPromise.then((reason) => ({ type: "abort" as const, reason })),
      ])
      if (outcome.type === "abort") {
        void startup.then((late) => {
          if (late.type !== "source") return
          const iterator = readAsyncIterator(late.value)
          if (!iterator.ok) {
            reportError(request, subject, "cleanup", iterator.cause)
            return
          }
          returnIterator(iterator.iterator, request, subject)
        })
        const code =
          outcome.reason === "expired" || outcome.reason === "revoked"
            ? outcome.reason
            : "source_failed"
        return failOpen(request, subject, code, "Subscription was cancelled before opening.")
      }
      if (outcome.type === "error") throw outcome.cause
      source = outcome.value
    } catch (cause) {
      reportError(request, subject, "source_startup", cause)
      abortActive(active, "source_failed")
      return failOpen(request, subject, "source_failed", "Subscription source failed to start.")
    }

    const iterator = readAsyncIterator(source)
    if (!iterator.ok) {
      reportError(request, subject, "source_startup", iterator.cause)
      abortActive(active, "source_failed")
      return failOpen(request, subject, "source_failed", "Subscription source failed to start.")
    }
    active.iterator = iterator.iterator
    if (active.closed) {
      returnSource(active)
      const code =
        active.abortReason === "expired" || active.abortReason === "revoked"
          ? active.abortReason
          : "source_failed"
      return failOpen(request, subject, code, "Subscription was cancelled.")
    }

    active.opened = true
    emitStart(request, subject, "opened")
    return { ok: true, events: deliveriesFor(active) }
  }

  return {
    open,
    beginSurfaceRevocation(surfaceId) {
      let state = revokingSurfaces.get(surfaceId)
      if (state === undefined) {
        state = { tickets: new Set(), succeeded: false }
        revokingSurfaces.set(surfaceId, state)
      }
      const ticket = {}
      state.tickets.add(ticket)
      const pending = pendingOpensBySurface.get(surfaceId)
      if (pending !== undefined) {
        for (const open of pending) open.revoked = true
      }
      const active = activeBySurface.get(surfaceId)
      if (active !== undefined) {
        for (const subscription of Array.from(active.values())) {
          abortActive(subscription, "revoked")
        }
      }
      let finished = false
      return {
        finish(outcome) {
          if (finished) return
          finished = true
          state.tickets.delete(ticket)
          if (outcome === "succeeded") state.succeeded = true
          if (
            state.tickets.size === 0 &&
            state.succeeded &&
            revokingSurfaces.get(surfaceId) === state
          ) {
            revokingSurfaces.delete(surfaceId)
          }
        },
      }
    },
  }
}
