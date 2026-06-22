# Validation

Datastar Kit decodes Datastar signal transport. Your app validates the decoded data.

That separation keeps validator-specific types, errors, transforms, and domain rules in application code, where they belong.

## Decode, then validate

Use `read.signals(request)` at the Datastar boundary, then call the schema library your app already uses:

```tsx
import { z } from "zod"
import { read, reply, state } from "datastar-kit"

const ContactInput = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.string().trim().email("Enter a valid email")
})

const contact = state({
  name: "",
  email: "",
  errors: {
    name: "",
    email: ""
  }
})

async function submitContact(request: Request): Promise<Response> {
  const result = ContactInput.safeParse(await read.signals(request))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)

    return reply.signals(
      contact.patch({
        errors: {
          name: fieldErrors.name?.[0] ?? "",
          email: fieldErrors.email?.[0] ?? ""
        }
      })
    )
  }

  await contacts.create(result.data)
  return reply.done()
}
```

`read.signals(request)` can throw when the Datastar payload is malformed or not a JSON object signal tree. Schema validation handles valid JSON with the wrong shape or unacceptable values.

## Show field errors

Bind fields to signal refs and render validation text from the same state helper:

```tsx
import { mod, post } from "datastar-kit"

const ContactForm = () => (
  <form
    data-signals={mod(contact.defaults, { ifMissing: true })}
    data-on:submit={mod(post("/contact"), { prevent: true })}
  >
    <label>
      Name
      <input
        name="name"
        data-bind={contact.refs.name}
      />
    </label>
    <small
      data-text={contact.refs.errors.name}
      data-show={contact.refs.errors.name}
    />

    <label>
      Email
      <input
        name="email"
        data-bind={contact.refs.email}
      />
    </label>
    <small
      data-text={contact.refs.errors.email}
      data-show={contact.refs.errors.email}
    />

    <button type="submit">Send</button>
  </form>
)
```

Recoverable validation errors should usually return successful Datastar responses so the browser applies the UI update. Do not rely on non-`200` response bodies to patch the page.

## Combine signal and element feedback

Use `reply.stream(...)` when one response should update signal state and patch HTML:

```tsx
import { event, reply } from "datastar-kit"

return reply.stream([
  event.signals(contact.reset()),
  event.patch(<p id="contact-result">Thanks, we will reply soon.</p>)
])
```

## Error categories

| Category         | Typical handling                                                          |
| ---------------- | ------------------------------------------------------------------------- |
| Validation error | Return `200` with signal or element patches near the relevant fields.     |
| Domain error     | Return a predictable UI patch when the current action can recover.        |
| Decode error     | Return `400`, or convert to a UI patch when that is better for the flow.  |
| Security error   | Return normal HTTP auth/permission responses and avoid revealing details. |
| Fatal error      | Log or trace it in app middleware and return a generic safe response.     |

Keep expected validation and domain failures close to the handler so it is obvious which UI patch they produce. Use app-level middleware for generic decode, security, and fatal failures.

Next: [Realtime](realtime.md).
