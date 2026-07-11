import { read, reply, state, mod, post } from "datastar-kit"
import { z } from "zod"
import { pageHead, type App } from "../app.js"
import { createSession, getCurrentUser, sessionCookie } from "../auth/session.js"
import { createUser } from "../db/users.js"

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  username: z
    .string()
    .trim()
    .min(3, "Use at least 3 characters")
    .max(24, "Keep it under 24 characters")
    .regex(/^[a-z0-9_-]+$/i, "Use letters, numbers, underscores, or dashes"),
  password: z.string().min(8, "Use at least 8 characters")
})

const signupState = state({
  name: "",
  username: "",
  password: "",
  _validation: {
    form: "",
    name: "",
    username: "",
    password: ""
  }
})

const SignupPage = () => (
  <main
    class="min-h-screen grid place-items-center p-4 bg-bg"
    data-signals={mod(signupState.defaults, { ifMissing: true })}
  >
    <section class="w-full max-w-96 bg-surface border border-border p-6 flex flex-col gap-5 shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
      <div class="flex items-center gap-2 border-b border-border pb-4">
        <span class="text-xs text-fg-muted select-none">›</span>
        <h1 class="text-xs font-semibold tracking-wider uppercase text-fg">
          Linear System / Register
        </h1>
      </div>
      <form
        class="flex flex-col gap-4"
        data-on:submit={mod(post("/signup"), { prevent: true })}
      >
        <label class="flex flex-col gap-1.5 section-label">
          Name
          <input
            class="field"
            autocomplete="name"
            placeholder="Your name"
            data-bind={signupState.refs.name}
          />
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={signupState.refs._validation.name}
          ></small>
        </label>
        <label class="flex flex-col gap-1.5 section-label">
          Username
          <input
            class="field"
            autocomplete="username"
            placeholder="Choose a username"
            data-bind={signupState.refs.username}
          />
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={signupState.refs._validation.username}
          ></small>
        </label>
        <label class="flex flex-col gap-1.5 section-label">
          Password
          <input
            class="field"
            type="password"
            autocomplete="new-password"
            placeholder="Create a password"
            data-bind={signupState.refs.password}
          />
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={signupState.refs._validation.password}
          ></small>
        </label>
        <small
          class="text-danger text-[13px] font-medium min-h-4"
          data-text={signupState.refs._validation.form}
        ></small>
        <button
          type="submit"
          class="btn-primary mt-1 py-2.5"
        >
          Initialize Instance
        </button>
      </form>
      <div class="pt-4 border-t border-border-subtle text-center">
        <a
          href="/login"
          class="text-fg-secondary text-[13px] font-medium hover:text-link hover:underline transition-colors"
        >
          Login Session
        </a>
      </div>
    </section>
  </main>
)

export const registerSignupPage = (app: App) => {
  app.get("/signup", async (c) => {
    if ((await getCurrentUser(c)) !== null) {
      return c.redirect("/workspace")
    }

    return reply.page(<SignupPage />, { title: "Create account · Linear clone", head: pageHead })
  })

  app.post("/signup", async (c) => {
    const result = signupSchema.safeParse(await read.signals(c.req.raw))
    if (!result.success) {
      const { fieldErrors } = z.flattenError(result.error)

      return reply.signals(
        signupState.patch({
          _validation: {
            ...signupState.defaults._validation,
            name: fieldErrors.name?.[0] ?? "",
            username: fieldErrors.username?.[0] ?? "",
            password: fieldErrors.password?.[0] ?? ""
          }
        })
      )
    }

    const user = await createUser(result.data)
    if (user === null) {
      return reply.signals(
        signupState.patch({
          _validation: {
            ...signupState.defaults._validation,
            username: "That username is already taken"
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
