import { serve } from "@hono/node-server"
import { app } from "./app.js"

const configuredPort = Number(process.env.PORT ?? 3_000)
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3_000

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`GenUI playground: http://localhost:${info.port}`)
})
