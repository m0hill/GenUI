import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import type { AppBindings } from "./app.js"
import { requireUser } from "./auth/session.js"
import { registerIssuePage } from "./pages/issue.js"
import { registerLoginPage } from "./pages/login.js"
import { registerSignupPage } from "./pages/signup.js"
import { registerWorkspacePage } from "./pages/workspace.js"

const app = new Hono<AppBindings>()

app.use("/public/*", serveStatic({ root: "./" }))

registerLoginPage(app)
registerSignupPage(app)

app.use("/workspace/*", requireUser)
app.use("/workspace", requireUser)
app.use("/projects", requireUser)
app.use("/issues/*", requireUser)
app.use("/logout", requireUser)

registerWorkspacePage(app)
registerIssuePage(app)

app.notFound((c) => c.text("Not Found", 404))

serve({ fetch: app.fetch }, () => {
  console.log("Hono Linear clone listening on http://localhost:3000")
})
