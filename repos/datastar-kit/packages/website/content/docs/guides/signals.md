# Signals

Datastar signals are browser-side values. Use them for sparse input and local UI feedback: form fields, filters, loading state, temporary messages, and validation text.

Do not treat signals as durable application state. Decode and validate them at the request boundary, then read trusted data from backend resources when authority matters.

## Start with `state`

For a related group of signals, define the defaults once:

```tsx
import { state } from "datastar-kit"

const signup = state({
  name: "",
  email: "",
  errors: {
    email: ""
  }
})
```

`state(...)` gives you five useful things:

| API                  | Use                                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| `signup.defaults`    | Cloned, frozen initial signal values for `data-signals`.                     |
| `signup.refs`        | Typed nested leaf signal refs for attributes and expressions.                |
| `signup.ref("path")` | A typed ref for any known path, including object-valued paths like `errors`. |
| `signup.patch(...)`  | Type-checked partial signal patches.                                         |
| `signup.reset(...)`  | Defaults, optionally merged with overrides.                                  |

Use those refs in Datastar attributes:

```tsx
import { mod, post } from "datastar-kit"

const SignupForm = () => (
  <form
    data-signals={mod(signup.defaults, { ifMissing: true })}
    data-on:submit={mod(post("/signup"), { prevent: true })}
  >
    <label>
      Name
      <input
        name="name"
        data-bind={signup.refs.name}
      />
    </label>

    <label>
      Email
      <input
        name="email"
        data-bind={signup.refs.email}
      />
    </label>

    <small data-text={signup.refs.errors.email} />
  </form>
)
```

Use `data-signals={mod(state.defaults, { ifMissing: true })}` for missing-only initialization. That keeps
reconnects and partial page updates from overwriting existing browser input unless you opt into that
behavior.

The one-argument `mod({ ... })` form is only for valueless presence attributes, such as
`data-ignore={mod({ self: true })}`. Signal initialization is value-bearing, so keep using
`mod(state.defaults, { ifMissing: true })` or `mod(false, { ifMissing: true })` for `data-signals`.

## Patch signal state

Return signal patches for small browser-side state changes:

```ts
return reply.signals(signup.patch({ errors: { email: "Enter a valid email" } }))
```

Use `null` to remove a signal through Datastar's patch semantics:

```ts
return reply.signals(signup.patch({ errors: { email: null } }))
```

Reset a form back to defaults:

```ts
return reply.signals(signup.reset())
```

Signal patches are best for messages, validation, toggles, and UI flags. If visible HTML depends on backend state, render HTML and use `reply.patch(...)`.

## Standalone signals

Use `signal(...)` when you only need one signal ref or when the signal name is not part of a grouped state helper:

```tsx
import { signal } from "datastar-kit"

const query = signal<string>("query")

<input type="search" data-bind={query} />
```

Use `local(...)` for underscore-prefixed local/private signal refs:

```tsx
import { local } from "datastar-kit"

const saving = local<boolean>("saving")

<button data-attr:disabled={saving}>Save</button>
```

Standalone refs can initialize their own signal value:

```tsx
import { mod } from "datastar-kit"
;<div data-signals:_saving={mod(false, { ifMissing: true })} />
```

Private names are a convention, not a security boundary. The browser still controls browser state.

## Expressions

For anything beyond a bare signal ref, use `js` so signal refs and JavaScript literals are serialized consistently:

```tsx
import { js, signal } from "datastar-kit"

const count = signal<number>("count")

<button data-attr:disabled={js`${count} >= ${10}`}>+</button>
```

For signal mutation in event handlers, write the assignment as an explicit expression:

```tsx
import { js, signal } from "datastar-kit"

const open = signal<boolean>("open")

<button data-on:click={js`${open} = false`}>Close</button>
```

## Read signal payloads

Use `read.signals(request)` for Datastar action requests that carry JSON signal state:

```ts
import { read } from "datastar-kit"

const signals = await read.signals(request)
const input = FormSchema.parse(signals)
```

Datastar Kit decodes the transport and verifies that the payload is a JSON object signal tree. Your application still owns schema validation and domain validation.

`GET` and `DELETE` actions read the `datastar` query parameter. Other methods read the request body as JSON. For ordinary HTML forms, multipart uploads, and non-Datastar APIs, use platform or framework readers instead.

## Signal names

Pass Datastar signal names or refs as attribute values, not raw HTML attribute suffixes:

```tsx
<input data-bind="projectName" />
```

Datastar Kit renders case-preserving forms where needed because HTML attribute names are case-insensitive. Grouped initialization is usually simplest:

```tsx
<div data-signals={{ projectName: "", projectKey: "" }} />
```

If you write raw keyed Datastar attributes by hand, use Datastar's DOM-safe keyed spelling:

```html
<input data-bind:project-name />
```

Both bind the Datastar signal `$projectName`.

Next: [Actions and responses](actions-and-responses.md).
