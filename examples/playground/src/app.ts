import { readFile } from "node:fs/promises"
import { Genui, type CallAuditEntry } from "genui"
import {
  actionError,
  parseSubscriptionRequest,
  type SubscriptionErrorCode,
  type SubscriptionOpenResult,
} from "genui/protocol"
import { Hono } from "hono"
import { demoActions } from "./actions.js"
import { createPendingApprovals } from "./pending-approvals.js"
import { demoSubscriptions } from "./subscriptions.js"
import { maxSubscriptionFrameBytes } from "./subscription-stream.js"
import {
  parseApprovalRequest,
  parseExecuteRequest,
  parseSurfaceRequest,
  type ExecuteEnvelope,
} from "./playground-codecs.js"

const requestJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

const sessionCookieName = "genui_session"
const sessionSubject = (request: Request): string | undefined => {
  const cookie = request.headers.get("cookie")
  if (cookie === null) return undefined

  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== sessionCookieName) continue
    try {
      const subject = decodeURIComponent(part.slice(separator + 1).trim())
      return subject.length > 0 && subject.length <= 256 ? subject : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

const pendingApprovals = createPendingApprovals()
const callAudits = new Map<string, CallAuditEntry[]>()
const callKey = (surfaceId: string, callId: string): string => JSON.stringify([surfaceId, callId])
const takeCallAudits = (surfaceId: string, callId: string): readonly CallAuditEntry[] => {
  const key = callKey(surfaceId, callId)
  const entries = callAudits.get(key) ?? []
  callAudits.delete(key)
  return entries
}

export const resetPlaygroundState = (): void => {
  pendingApprovals.clear()
  callAudits.clear()
}

const genui = new Genui<Readonly<Record<string, never>>>({
  actions: demoActions,
  subscriptions: demoSubscriptions,
  onCall: (entry) => {
    const key = callKey(entry.surfaceId, entry.callId)
    const entries = callAudits.get(key) ?? []
    entries.push(entry)
    callAudits.set(key, entries)
  },
})
export const playgroundGeneration = genui.generation({
  actions: demoActions,
  subscriptions: demoSubscriptions,
})

export const revokePlaygroundSurface = (id: string): Promise<void> => genui.revoke(id)

export const app = new Hono()

app.get("/", async (context) => {
  if (sessionSubject(context.req.raw) === undefined) {
    context.header(
      "set-cookie",
      `${sessionCookieName}=${encodeURIComponent(globalThis.crypto.randomUUID())}; HttpOnly; SameSite=Strict; Path=/`,
    )
  }
  return context.html(await readFile(new URL("../index.html", import.meta.url), "utf8"))
})

app.get("/client.js", async (context) => {
  const source = await readFile(new URL("../dist/client.js", import.meta.url), "utf8")
  return context.body(source, 200, {
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
  })
})

app.get("/genui/instructions", (context) => {
  const guidance = playgroundGeneration.guidance()
  return context.text(`${guidance.environment}\n\n${guidance.capabilityContract}`)
})

app.post("/genui/surface", async (context) => {
  const subject = sessionSubject(context.req.raw)
  if (subject === undefined) {
    return context.json(actionError("not_granted", "Playground session is required."), 401)
  }
  const request = parseSurfaceRequest(await requestJson(context.req.raw))
  if (request === undefined) {
    return context.json(actionError("invalid_input", "Surface content must be a string."), 400)
  }

  const surface = await playgroundGeneration.createSurface({
    content: request.content,
    subject,
  })
  return context.json(surface)
})

type SubscriptionOpenFailure = Extract<SubscriptionOpenResult, { readonly ok: false }>

const subscriptionFailure = (
  code: SubscriptionErrorCode,
  message: string,
): SubscriptionOpenFailure => ({ ok: false, error: { code, message } })

app.post("/genui/subscribe", async (context) => {
  const subject = sessionSubject(context.req.raw)
  if (subject === undefined) {
    return context.json(subscriptionFailure("not_granted", "Playground session is required."), 401)
  }
  const request = parseSubscriptionRequest(await requestJson(context.req.raw))
  if (request === undefined) {
    return context.json(
      subscriptionFailure("invalid_input", "Malformed subscription request."),
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

  const opened = await genui.subscribe(request, {}, { subject, signal: sourceController.signal })
  if (!opened.ok) {
    stopSource()
    return context.json(opened, 400)
  }

  const iterator = opened.events[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  let finished = false
  const finish = async (): Promise<void> => {
    if (finished) return
    finished = true
    stopSource()
    await iterator.return?.()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return
      try {
        const next = await iterator.next()
        if (next.done) {
          finished = true
          detachRequestSignal()
          controller.close()
          return
        }
        const frame = encoder.encode(`${JSON.stringify(next.value)}\n`)
        if (frame.byteLength > maxSubscriptionFrameBytes) {
          await finish()
          controller.error(new Error("Subscription delivery frame exceeded its transport limit."))
          return
        }
        controller.enqueue(frame)
      } catch (cause) {
        finished = true
        stopSource()
        controller.error(cause)
      }
    },
    cancel: finish,
  })
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
})

app.post("/genui/execute", async (context) => {
  const subject = sessionSubject(context.req.raw)
  if (subject === undefined) {
    return context.json(
      {
        result: actionError("not_granted", "Playground session is required."),
        audit: [],
      } satisfies ExecuteEnvelope,
      401,
    )
  }
  const request = parseExecuteRequest(await requestJson(context.req.raw))
  if (request === undefined) {
    return context.json(
      {
        result: actionError("invalid_input", "Malformed action call."),
        audit: [],
      } satisfies ExecuteEnvelope,
      400,
    )
  }
  const { call } = request

  const result = await genui.execute(
    call,
    {},
    {
      subject,
      approve: (action, input) =>
        pendingApprovals.check({
          surfaceId: call.surfaceId,
          callId: call.callId,
          subject,
          action: action.name,
          input,
          retryToken: request.approvalRetryToken,
        }),
    },
  )
  const approvalToken =
    !result.ok && result.error.code === "approval_required"
      ? pendingApprovals.token({ surfaceId: call.surfaceId, callId: call.callId, subject })
      : undefined
  return context.json({
    result,
    audit: takeCallAudits(call.surfaceId, call.callId),
    ...(approvalToken === undefined ? {} : { approvalToken }),
  } satisfies ExecuteEnvelope)
})

app.post("/genui/approve", async (context) => {
  const subject = sessionSubject(context.req.raw)
  if (subject === undefined) {
    return context.json(actionError("not_granted", "Playground session is required."), 401)
  }
  const request = parseApprovalRequest(await requestJson(context.req.raw))
  if (request === undefined) {
    return context.json(actionError("invalid_input", "Malformed approval request."), 400)
  }

  const retryToken = pendingApprovals.approve({
    surfaceId: request.surfaceId,
    callId: request.callId,
    subject,
    token: request.token,
  })
  if (retryToken === undefined) {
    return context.json(actionError("not_granted", "Approval is not pending."), 409)
  }
  if (retryToken === false) {
    return context.json(actionError("not_granted", "Approval credentials do not match."), 403)
  }
  return context.json({ retryToken })
})
