import { event, js, mod, post, read, reply, state, type Expr } from "datastar-kit"
import type { Context } from "hono"
import { z } from "zod"
import type { Env } from "../../server"

export const validationState = state({
  name: "",
  email: "",
  errors: {
    name: "",
    email: ""
  }
})

const SignupSignals = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters."),
  email: z.email("Enter a valid email address.")
})

const SignupStatus = (props: { ok?: boolean }) => (
  <p
    id="signup-status"
    class={props.ok === true ? "text-sm text-fg" : "text-sm text-fg-muted"}
  >
    {props.ok === true
      ? "Valid. The server accepted this submission."
      : "Submit the form and the server validates it with Zod."}
  </p>
)

const FieldError = (props: { signal: Expr<string> }) => (
  <p
    class="mt-1.5 text-xs text-danger"
    data-text={props.signal}
    data-show={js`${props.signal} !== ''`}
  />
)

export const ValidationDemo = () => (
  <form
    class="space-y-4"
    data-on:submit={mod(post("/playground/signup"), { prevent: true })}
  >
    <div>
      <label
        for="signup-name"
        class="mb-1.5 block text-sm font-medium text-fg"
      >
        Name
      </label>
      <input
        id="signup-name"
        class="field"
        placeholder="Ada Lovelace"
        data-bind={validationState.refs.name}
      />
      <FieldError signal={validationState.refs.errors.name} />
    </div>
    <div>
      <label
        for="signup-email"
        class="mb-1.5 block text-sm font-medium text-fg"
      >
        Email
      </label>
      <input
        id="signup-email"
        class="field"
        placeholder="ada@example.com"
        data-bind={validationState.refs.email}
      />
      <FieldError signal={validationState.refs.errors.email} />
    </div>
    <div class="flex items-center justify-between gap-4">
      <button
        type="submit"
        class="btn-primary"
      >
        Submit
      </button>
    </div>
    <div class="border-t border-border-subtle pt-4">
      <SignupStatus />
    </div>
  </form>
)

export const signup = async (c: Context<Env>) => {
  const result = SignupSignals.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)
    return reply.stream([
      event.signals(
        validationState.patch({
          errors: {
            name: fieldErrors.name?.[0] ?? "",
            email: fieldErrors.email?.[0] ?? ""
          }
        })
      ),
      event.patch(<SignupStatus ok={false} />)
    ])
  }

  return reply.stream([
    event.signals(validationState.patch({ errors: validationState.defaults.errors })),
    event.patch(<SignupStatus ok />)
  ])
}
