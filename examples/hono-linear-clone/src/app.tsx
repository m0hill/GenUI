import type { Hono } from "hono"
import type { User } from "./db/schema.js"

export type AppVariables = {
  user: User
}

export type AppBindings = {
  Variables: AppVariables
}

export type App = Hono<AppBindings>

export const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

export const pageHead = [
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />,
  <link
    rel="preconnect"
    href="https://fonts.googleapis.com"
  />,
  <link
    rel="preconnect"
    href="https://fonts.gstatic.com"
    crossorigin="anonymous"
  />,
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />,
  <link
    href="/public/styles.css"
    rel="stylesheet"
  />,
  <script
    type="module"
    src={DATASTAR_RUNTIME}
  />
]
