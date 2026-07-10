import { readFile } from "node:fs/promises"
import { Genui, type CallAuditEntry } from "genui"
import { actionError, codeDialect } from "genui/protocol"
import { Hono } from "hono"
import { demoActions } from "./actions.js"
import { createPendingApprovals } from "./pending-approvals.js"
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
  onCall: (entry) => {
    const key = callKey(entry.surfaceId, entry.callId)
    const entries = callAudits.get(key) ?? []
    entries.push(entry)
    callAudits.set(key, entries)
  },
})

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

app.get("/genui/instructions", (context) => context.text(genui.instructions()))

app.post("/genui/surface", async (context) => {
  const subject = sessionSubject(context.req.raw)
  if (subject === undefined) {
    return context.json(actionError("not_granted", "Playground session is required."), 401)
  }
  const request = parseSurfaceRequest(await requestJson(context.req.raw))
  if (request === undefined) {
    return context.json(actionError("invalid_input", "Surface content must be a string."), 400)
  }

  const surface = await genui.surface({
    dialect: codeDialect,
    content: request.content,
    actions: demoActions.map((definition) => definition.name),
    subject,
  })
  return context.json(surface)
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
  const call = parseExecuteRequest(await requestJson(context.req.raw))
  if (call === undefined) {
    return context.json(
      {
        result: actionError("invalid_input", "Malformed action call."),
        audit: [],
      } satisfies ExecuteEnvelope,
      400,
    )
  }

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
        }),
    },
  )
  return context.json({
    result,
    audit: takeCallAudits(call.surfaceId, call.callId),
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

  const approved = pendingApprovals.approve({
    surfaceId: request.surfaceId,
    callId: request.callId,
    subject,
  })
  if (approved === undefined) {
    return context.json(actionError("not_granted", "Approval is not pending."), 409)
  }
  if (!approved) {
    return context.json(actionError("not_granted", "Approval belongs to another subject."), 403)
  }
  return context.body(null, 204)
})
