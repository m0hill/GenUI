import { readFile } from "node:fs/promises"
import { codeDialect, Genui } from "@genui/genui"
import { actionError, parseActionCall } from "@genui/protocol"
import { Hono } from "hono"
import { demoActionNames, demoActions } from "./actions.js"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requestJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

export const genui = new Genui<Readonly<Record<string, never>>>({ actions: demoActions })

export const app = new Hono()

app.get("/", async (context) =>
  context.html(await readFile(new URL("../index.html", import.meta.url), "utf8")),
)

app.get("/client.js", async (context) => {
  const source = await readFile(new URL("../dist/client.js", import.meta.url), "utf8")
  return context.body(source, 200, {
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
  })
})

app.get("/genui/instructions", (context) => context.text(genui.instructions()))

app.post("/genui/surface", async (context) => {
  const body = await requestJson(context.req.raw)
  if (!isRecord(body) || typeof body.content !== "string") {
    return context.json(actionError("invalid_input", "Surface content must be a string."), 400)
  }

  const surface = await genui.surface({
    dialect: codeDialect,
    content: body.content,
    actions: demoActionNames,
  })
  return context.json(surface)
})

app.post("/genui/execute", async (context) => {
  const body = await requestJson(context.req.raw)
  const call = isRecord(body) ? parseActionCall(body.call) : undefined
  if (call === undefined) {
    return context.json(actionError("invalid_input", "Malformed action call."), 400)
  }

  const approved = isRecord(body) && body.approved === true
  const result = await genui.execute(call, {}, { approve: () => approved })
  return context.json(result)
})
