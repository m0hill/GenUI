import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { z } from "zod"
import { event, read, reply, state, mod, post } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const signup = state({
  name: "",
  email: "",
  errors: {
    name: "",
    email: ""
  }
})

const SignupSignals = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email address")
})
const app = new Hono()

app.get("/", () =>
  reply.page(
    <main data-signals={mod(signup.defaults, { ifMissing: true })}>
      <h1>Signup</h1>
      <form data-on:submit={mod(post("/signup"), { prevent: true })}>
        <p>
          <label>
            Name
            <br />
            <input
              name="name"
              data-bind={signup.refs.name}
            />
          </label>
          <br />
          <small
            style="display: none; color: crimson"
            data-show={signup.refs.errors.name}
            data-text={signup.refs.errors.name}
          ></small>
        </p>

        <p>
          <label>
            Email
            <br />
            <input
              name="email"
              data-bind={signup.refs.email}
            />
          </label>
          <br />
          <small
            style="display: none; color: crimson"
            data-show={signup.refs.errors.email}
            data-text={signup.refs.errors.email}
          ></small>
        </p>

        <button type="submit">Create account</button>
      </form>
      <p id="result"></p>
    </main>,
    {
      title: "Datastar form validation",
      head: (
        <script
          type="module"
          src={DATASTAR_RUNTIME}
        />
      )
    }
  )
)

app.post("/signup", async (c) => {
  const result = SignupSignals.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)
    const errors = {
      name: fieldErrors.name?.[0] ?? "",
      email: fieldErrors.email?.[0] ?? ""
    }

    return reply.stream([
      event.signals(signup.patch({ errors })),
      event.patch(<p id="result">Please fix the form.</p>)
    ])
  }

  const input = result.data
  return reply.stream([
    event.signals(signup.reset()),
    event.patch(
      <p id="result">
        Thanks {input.name}, check {input.email}.
      </p>
    )
  ])
})

const port = Number(process.env.PORT ?? "3000")
serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono form validation listening on http://localhost:${port}`)
})
