import { Hono } from "hono"
import { event, reply, read, state, get, local, patch, put } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const schema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.email("Enter a valid email address.")
})

type Contact = z.infer<typeof schema>

const editFormState = state({
  firstName: "",
  lastName: "",
  email: "",
  errors: {
    firstName: "",
    lastName: "",
    email: ""
  }
})
const fetching = local<boolean>("fetching")

const originalContact: Contact = {
  firstName: "John",
  lastName: "Doe",
  email: "joe@blow.com"
}

let contact = { ...originalContact }

const ContactView = () => (
  <div id="demo">
    <p>First Name: {contact.firstName}</p>
    <p>Last Name: {contact.lastName}</p>
    <p>Email: {contact.email}</p>
    <div role="group">
      <button
        class="info"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/click_to_edit/edit")}
      >
        Edit
      </button>
      <button
        class="warning"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={patch("/examples/click_to_edit/reset")}
      >
        Reset
      </button>
    </div>
  </div>
)

const ContactForm = () => (
  <div id="demo">
    <label>
      First Name
      <input
        type="text"
        required
        data-bind={editFormState.refs.firstName}
        data-attr:disabled={fetching}
      />
      <small
        class="field-error"
        style="display: none"
        data-show={editFormState.refs.errors.firstName}
        data-text={editFormState.refs.errors.firstName}
      ></small>
    </label>
    <label>
      Last Name
      <input
        type="text"
        required
        data-bind={editFormState.refs.lastName}
        data-attr:disabled={fetching}
      />
      <small
        class="field-error"
        style="display: none"
        data-show={editFormState.refs.errors.lastName}
        data-text={editFormState.refs.errors.lastName}
      ></small>
    </label>
    <label>
      Email
      <input
        type="email"
        required
        data-bind={editFormState.refs.email}
        data-attr:disabled={fetching}
      />
      <small
        class="field-error"
        style="display: none"
        data-show={editFormState.refs.errors.email}
        data-text={editFormState.refs.errors.email}
      ></small>
    </label>
    <div role="group">
      <button
        class="success"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={put("/examples/click_to_edit")}
      >
        Save
      </button>
      <button
        class="error"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/click_to_edit/cancel")}
      >
        Cancel
      </button>
    </div>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Click To Edit"
      slug="click_to_edit"
      summary="Swaps a read-only record for an edit form and saves the signal payload server-side."
      source="https://data-star.dev/examples/click_to_edit"
    >
      <ContactView />
    </ExampleLayout>,
    {
      title: "Click To Edit - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/edit", () =>
  reply.stream([event.signals(editFormState.reset(contact)), event.patch(<ContactForm />)])
)

example.get("/cancel", () =>
  reply.stream([event.signals(editFormState.reset(contact)), event.patch(<ContactView />)])
)

example.patch("/reset", () => {
  contact = { ...originalContact }
  return reply.stream([event.signals(editFormState.reset(contact)), event.patch(<ContactView />)])
})

example.put("/", async (c) => {
  const result = schema.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)

    return reply.signals(
      editFormState.patch({
        errors: {
          firstName: fieldErrors.firstName?.[0] ?? "",
          lastName: fieldErrors.lastName?.[0] ?? "",
          email: fieldErrors.email?.[0] ?? ""
        }
      })
    )
  }

  contact = result.data
  return reply.stream([event.signals(editFormState.reset(contact)), event.patch(<ContactView />)])
})
