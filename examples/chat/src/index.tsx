import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import chat from "./pages/chat/index.js"
import sessions from "./pages/sessions.js"

const app = new Hono()

app.get("/public/generated-ui.js", async (c, next) => {
  c.header("Cache-Control", "no-store")
  await next()
})
app.use("/public/*", serveStatic({ root: "./" }))

app.route("/", chat).route("/sessions", sessions)

app.notFound((c) => c.text("Not Found", 404))

const port = Number(process.env.PORT ?? "3000")

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono AI chat listening on http://localhost:${info.port}`)
})
