# code/0 surfaces

Use `code/0` when a model should author an interactive HTML and JavaScript
fragment. The fragment runs as code, not as a template language.

```ts
import { codeDialect, Genui } from "@genui/genui"

const surface = await genui.surface({
  dialect: codeDialect,
  content: generatedFragment,
  actions: ["orders.search", "orders.update_status"],
})
```

The runtime stores `content` verbatim. It does not sanitize, rewrite, compile,
or resolve dependencies in the fragment. Grant projection still removes
unknown, blocked, duplicate, and confidential actions.

Use `genui.instructions()` to give a model the code/0 contract and the current
action descriptors. The output includes each action's input JSON Schema.

## Guest content

Return fragment HTML without a document wrapper or Markdown fence. Use standard
HTML, inline CSS, DOM APIs, and inline `<script type="module">` blocks.

Keep scripts and styles inline. Do not use network APIs, external scripts,
external stylesheets, parent-page access, persistent storage, or navigation.
The sandbox blocks these facilities; code that depends on them will fail.

Handle `genui.call()` failures and render a useful error state. Generated code
must not treat a rendered confirmation or button state as authorization.

## Isolation boundary

`mount()` creates an opaque-origin iframe with these attributes:

```html
<iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer">
```

The iframe document contains a UTF-8 declaration, the CSP below, the trusted
guest bootstrap, and then the generated fragment. The bootstrap always appears
before generated content.

```text
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src <host image policy>;
connect-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none'
```

`imagePolicy` maps to `img-src` as follows:

- `none` maps to `'none'` and is the default.
- `data` maps to `data:`.
- `https` maps to `https:`.
- `https-and-data` maps to `https: data:`.

The iframe boundary is the security control. Content filtering is not part of
the code/0 security model.

## Guest bridge

The bootstrap installs exactly this public API on `window.genui`:

```js
genui.surfaceId
genui.actions
await genui.call(name, input)
genui.snapshot(fn)
```

`genui.surfaceId` is the current surface ID. `genui.actions` is the grant
snapshot embedded by the trusted host before generated content. It is
available to top-level guest scripts without waiting for an event. Each
descriptor contains `name`, `description`, `effect`, `requiresApproval`, and
optional `intent` and `inputSchema` fields.

`genui.call(name, input)` posts a call carrying `surfaceId`, a unique `callId`,
the action name, and input. It resolves to the successful action output. It
rejects with `GenuiActionError { code, message }` for an action error.

Results correlate by `callId`. Unknown and duplicate result messages are
ignored. Result and snapshot-request messages are accepted only from the
iframe's parent window with the matching channel and surface ID. The guest
action list is descriptive; mutating it cannot change the host or kernel grant.

`genui.snapshot(fn)` registers one state provider. The host calls the provider
without arguments to capture JSON-serializable state. When a replacement
document starts with restored state, registration immediately calls the same
provider with that value. Apply the value and return current state:

```js
let state = { selected: null }

genui.snapshot((restored) => {
  if (restored !== undefined) state = restored
  return state
})
```

Keep the provider synchronous and side-effect-free when it is called without
arguments. Provider failures are reported through `guest_error` and make that
snapshot unavailable.

## Host enforcement

The host broker rejects calls missing from the surface grant before transport.
The kernel independently reloads the surface record, checks current policy and
grant, validates input, obtains authoritative approval, executes, and validates
output. If it returns `approval_required`, the broker invokes
`confirm(action, call, intent)` with the server-rendered intent and retries the
same call once after confirmation.

Render consent UI in trusted host code. Display the supplied intent instead of
reconstructing approval text from raw guest input.

## Errors, navigation, and liveness

The bootstrap forwards `window.onerror` and `unhandledrejection` as
`guest_error` events with a message and a stack when available. Handle these in
`mount({ onEvent })` and make them visible or send them back to the generating
model.

A generated iframe may try to navigate itself despite the CSP. After the
initial document load, any additional iframe `load` is a violation. The host
kills the iframe, replaces it with an inert error, and emits:

```ts
{ type: "violation", reason: "navigation" }
```

Do not restore or continue a surface after this event. Create and mount a new
surface instead.

The bootstrap posts a heartbeat immediately and every second. The host checks
for a gap only while its document is visible and the iframe intersects the
viewport. A gap over six seconds kills the surface, renders an inert error, and
emits:

```ts
{ type: "violation", reason: "unresponsive" }
```

Heartbeat monitoring is best-effort liveness detection, not CPU or memory
containment. A synchronous loop in a same-renderer iframe can also starve the
host monitor. Do not treat the tripwire as an isolation or quota boundary.
