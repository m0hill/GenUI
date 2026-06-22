import { read, reply, state, mod, post } from "datastar-kit"
import { z } from "zod"
import { pageHead, type App } from "../app.js"
import { createSession, getCurrentUser, sessionCookie } from "../auth/session.js"
import { authenticate } from "../db/users.js"

const loginSchema = z.object({
  username: z.string().trim().min(3, "Use at least 3 characters"),
  password: z.string().min(1, "Enter your password")
})

const loginState = state({
  username: "",
  password: "",
  _validation: {
    form: "",
    username: "",
    password: ""
  }
})

const LoginPage = () => (
  <main
    class="min-h-screen grid place-items-center p-4 bg-bg"
    data-signals={mod(loginState.defaults, { ifMissing: true })}
  >
    <section class="w-full max-w-96 bg-surface border border-border p-6 flex flex-col gap-5 shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
      <div class="flex items-center gap-2 border-b border-border pb-4">
        <span class="text-xs text-fg-muted select-none">›</span>
        <h1 class="text-xs font-semibold tracking-wider uppercase text-fg">
          Linear System / Login
        </h1>
      </div>
      <form
        class="flex flex-col gap-4"
        data-on:submit={mod(post("/login"), { prevent: true })}
      >
        <label class="flex flex-col gap-1.5 section-label">
          Username
          <input
            class="field"
            autocomplete="username"
            placeholder="Enter username"
            data-bind={loginState.refs.username}
          />
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={loginState.refs._validation.username}
          ></small>
        </label>
        <label class="flex flex-col gap-1.5 section-label">
          Password
          <input
            class="field"
            type="password"
            autocomplete="current-password"
            placeholder="Enter password"
            data-bind={loginState.refs.password}
          />
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={loginState.refs._validation.password}
          ></small>
        </label>
        <small
          class="text-danger text-[13px] font-medium min-h-4"
          data-text={loginState.refs._validation.form}
        ></small>
        <button
          type="submit"
          class="btn-primary mt-1 py-2.5"
        >
          Proceed Securely
        </button>
      </form>
      <div class="pt-4 border-t border-border-subtle text-center">
        <a
          href="/signup"
          class="text-fg-secondary text-[13px] font-medium hover:text-link hover:underline transition-colors"
        >
          Create Workspace
        </a>
      </div>
    </section>
  </main>
)

export const registerLoginPage = (app: App) => {
  app.get("/", async (c) =>
    (await getCurrentUser(c)) === null ? c.redirect("/login") : c.redirect("/workspace")
  )

  app.get("/login", async (c) => {
    if ((await getCurrentUser(c)) !== null) {
      return c.redirect("/workspace")
    }

    return reply.page(<LoginPage />, { title: "Sign in · Linear clone", head: pageHead })
  })

  app.post("/login", async (c) => {
    const result = loginSchema.safeParse(await read.signals(c.req.raw))
    if (!result.success) {
      const { fieldErrors } = z.flattenError(result.error)

      return reply.signals(
        loginState.patch({
          _validation: {
            ...loginState.defaults._validation,
            username: fieldErrors.username?.[0] ?? "",
            password: fieldErrors.password?.[0] ?? ""
          }
        })
      )
    }

    const user = await authenticate(result.data)
    if (user === null) {
      return reply.signals(
        loginState.patch({
          _validation: {
            ...loginState.defaults._validation,
            form: "Username or password is incorrect"
          }
        })
      )
    }

    return reply.navigate(
      "/workspace",
      {},
      { headers: { "set-cookie": sessionCookie(await createSession(user.id)) } }
    )
  })
}
