import { Hono } from "hono"
import { stream } from "hono/streaming"
import { actionError, parseSubscriptionRequest, subscriptionOpenError } from "genui/protocol"
import { z } from "zod"
import { executeGeneratedUiAction, openGeneratedUiSubscription } from "./ai/genui.js"
import {
  authenticatedSessionFromRequest,
  type AuthenticatedSession,
  type AuthenticatedSessionRegistry,
} from "./authenticated-session.js"
import {
  parseApprovalExchangeRequest,
  parseExecuteRequest,
  pendingApprovals,
  type ExecuteEnvelope,
} from "./approval.js"
import type { JsonPreferenceStore } from "./preferences.js"
import { type JsonlChatSession, SurfaceSnapshot } from "./session.js"

const SurfaceSnapshots = z
  .array(
    z
      .object({
        surfaceId: z.string().min(1).max(256),
        snapshot: SurfaceSnapshot,
      })
      .strict(),
  )
  .max(64)

const requestJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const authenticatedRequest = (
  sessions: AuthenticatedSessionRegistry,
  request: Request,
): AuthenticatedSession | undefined => {
  const session = authenticatedSessionFromRequest(sessions, request)
  return session !== undefined && request.headers.get("x-chat-csrf") === session.csrfToken
    ? session
    : undefined
}

/** Build the chat-owned HTTP boundary for generated-interface operations. */
export const createGenuiRoutes = (options: {
  readonly sessions: AuthenticatedSessionRegistry
  readonly chatSession: JsonlChatSession
  readonly preferences: JsonPreferenceStore
}): Hono => {
  const routes = new Hono()

  routes.post("/execute", async (context) => {
    const current = authenticatedRequest(options.sessions, context.req.raw)
    if (current === undefined) {
      return context.json(
        {
          result: actionError("unknown_surface", "Authentication is required."),
        } satisfies ExecuteEnvelope,
        401,
      )
    }
    const request = parseExecuteRequest(await requestJson(context.req.raw))
    if (request === undefined) {
      return context.json(
        {
          result: actionError("invalid_input", "Malformed GenUI action call."),
        } satisfies ExecuteEnvelope,
        400,
      )
    }
    const result = await executeGeneratedUiAction(
      request.call,
      options.preferences,
      current.subject,
      (_action, input) =>
        pendingApprovals.check({
          subject: current.subject,
          call: request.call,
          input,
          retryToken: request.approvalRetryToken,
        }),
    )
    const pendingApproval =
      !result.ok && result.error.code === "approval_required"
        ? pendingApprovals.pending(request.call, current.subject)
        : undefined
    return context.json({
      result,
      ...(pendingApproval === undefined ? {} : { pendingApproval }),
    } satisfies ExecuteEnvelope)
  })

  routes.post("/approve", async (context) => {
    const current = authenticatedRequest(options.sessions, context.req.raw)
    if (current === undefined) return context.json({ error: "Authentication is required." }, 401)
    const request = parseApprovalExchangeRequest(await requestJson(context.req.raw))
    if (request === undefined) return context.json({ error: "Malformed approval request." }, 400)
    const retryToken = pendingApprovals.exchange(request.pendingApproval, current.subject)
    if (retryToken === undefined) return context.json({ error: "Approval is unavailable." }, 404)
    if (retryToken === false) return context.json({ error: "Approval is not authorized." }, 403)
    return context.json({ retryToken })
  })

  routes.post("/subscribe", async (context) => {
    const current = authenticatedRequest(options.sessions, context.req.raw)
    if (current === undefined) {
      return context.json(
        subscriptionOpenError("unknown_surface", "Authentication is required."),
        401,
      )
    }
    const request = parseSubscriptionRequest(await requestJson(context.req.raw))
    if (request === undefined) {
      return context.json(
        subscriptionOpenError("invalid_input", "Malformed subscription request."),
        400,
      )
    }

    const requestSignal = context.req.raw.signal
    const sourceController = new AbortController()
    const abortSource = (): void => sourceController.abort()
    if (requestSignal.aborted) abortSource()
    else requestSignal.addEventListener("abort", abortSource, { once: true })
    const detachRequestSignal = (): void => {
      requestSignal.removeEventListener("abort", abortSource)
    }
    const stopSource = (): void => {
      detachRequestSignal()
      sourceController.abort()
    }

    const opened = await openGeneratedUiSubscription(
      request,
      options.preferences,
      current.subject,
      sourceController.signal,
    )
    if (!opened.ok) {
      stopSource()
      return context.json(opened, 400)
    }

    context.header("cache-control", "no-store")
    context.header("content-type", "application/x-ndjson; charset=utf-8")
    context.header("x-content-type-options", "nosniff")
    return stream(context, async (output) => {
      output.onAbort(stopSource)
      try {
        for await (const delivery of opened.events) {
          await output.writeln(JSON.stringify(delivery))
        }
      } finally {
        stopSource()
      }
    })
  })

  routes.post("/snapshots", async (context) => {
    const current = authenticatedRequest(options.sessions, context.req.raw)
    if (current === undefined) {
      return context.json({ error: "Authentication is required." }, 401)
    }
    const snapshots = SurfaceSnapshots.safeParse(await requestJson(context.req.raw))
    if (!snapshots.success) {
      return context.json({ error: "Invalid generated UI snapshots." }, 400)
    }
    const written = await options.chatSession.appendSurfaceSnapshots({
      subject: current.subject,
      snapshots: snapshots.data,
    })
    if (!written.ok) {
      return context.json({ error: "Surface snapshot access is not granted." }, 403)
    }
    return context.body(null, 204)
  })

  return routes
}
