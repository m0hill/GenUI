import { Hono } from "hono"
import { trimTrailingSlash } from "hono/trailing-slash"
import agent from "./agent"
import docs from "./pages/docs"
import index from "./pages/index"
import { notFound } from "./pages/not-found"
import playground from "./pages/playground"

export { VisitorCounter } from "./realtime/counter"

export type Env = { Bindings: CloudflareBindings }

const app = new Hono<Env>()

app.use(trimTrailingSlash())

app.route("/", index).route("/", agent).route("/playground", playground).route("/docs", docs)

app.notFound(notFound)

export default app
