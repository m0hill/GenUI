# code/0 surfaces

Use `code/0` when a model should author an interactive HTML and JavaScript
fragment. The fragment runs as code, not as a template language.

Treat the dialect identifier as the wire version. The current contract is
`code/0`; npm package versions do not replace it.

```ts
import { checkGeneratedInterface } from "@genui/check"

const ordersUi = genui.generation({
  actions: [searchOrders, updateOrderStatus],
  subscriptions: [orderChanges],
})

const guidance = ordersUi.guidance()
const systemInstructions = guidance.environment
const renderUiToolDescription =
  `Render an interface using only these actions and subscriptions:\n\n${guidance.capabilityContract}`

const checked = await checkGeneratedInterface(ordersUi, {
  content: generatedFragment,
  signal: request.signal,
})
if (!checked.ok) return checked.report

const surface = await ordersUi.createSurface({ content: generatedFragment })
```

The runtime stores `content` verbatim. It does not sanitize, rewrite, compile,
or resolve dependencies in the fragment. `generation()` selects registered
definitions once so model guidance and surface creation cannot drift to
different capability sets. It rejects duplicate or unregistered definitions.
Grant projection still omits blocked and confidential actions and
subscriptions. Use `genui.diagnostics(surface.id)` to inspect both projection
decisions.

Call `guidance()` when preparing the model request. `environment` is the stable
code/0 sandbox, bridge, lifecycle, and styling contract.
`capabilityContract` contains only the selected capabilities that current
policy permits the model to see. It renders schemas as compact TypeScript-like
declarations. Constraints that TypeScript cannot express remain as comments;
if a schema cannot be represented safely, its declaration becomes `unknown`
and the exact JSON Schema is included as a fallback.

The generation retains selected capability names, not an authorization
snapshot. Both `guidance()` and `createSurface()` project current policy when
called. Keep `environment` in stable system instructions. Place the selected
`capabilityContract` beside the provider's surface-generation tool when the
provider supports tool-specific instructions. This keeps unrelated model turns
free of capability details and lets providers cache the stable section. GenUI
does not invoke a model or prescribe a provider interface.

Install `@genui/check` separately in server-side generation code that wants
preflight. `checkGeneratedInterface()` parses
the fragment, requires scripts to be inline `type="module"` blocks, and checks
their JavaScript against the generation's currently visible action and
subscription declarations. An invalid result contains bounded, serializable
diagnostics and a report suitable for a model retry. Failures outside model
content reject with `GeneratedInterfaceCheckError`; do not present them as
repair instructions. Cancellation rejects with the supplied signal's reason.

GenUI-owned diagnostics have stable meanings:

- `GENUI006` reports literal `null` or `undefined` when the selected capability
  input schema statically excludes it;
- `GENUI007` reports module imports and re-exports;
- `GENUI008` reports direct network, connection, beacon, and worker-loading
  APIs;
- `GENUI009` reports persistent browser storage and cookies;
- `GENUI010` reports parent-page, opener, and frame-owner access;
- `GENUI011` reports direct location, history, window-open, and Navigation API
  mutation;
- `GENUI012` reports direct runtime code generation and string-valued timers;
- `GENUI013` reports `document.currentScript`; and
- `GENUI014` reports unsupported external-resource, embedded-document, base,
  refresh, form, and navigation HTML structures.

The JavaScript rules resolve real browser globals and direct `window`, `self`,
or `globalThis` property access, including static computed properties. Local
shadows are accepted. The checker does not perform general data-flow analysis.
Unknown schema compatibility is accepted and remains subject to runtime
validation. Image URLs remain host-policy-dependent and are not rejected
unconditionally.

The check improves feedback; it does not grant authority or make generated code
trusted. `createSurface()`, the browser broker, and the kernel still apply their
normal fail-closed policy, grant, schema, approval, and lifecycle checks.

## Guest content

Return fragment HTML without a document wrapper or Markdown fence. Use standard
HTML, inline CSS, DOM APIs, and inline `<script type="module">` blocks.

Keep scripts and styles inline. Do not use network APIs such as `fetch`,
`WebSocket`, or `EventSource`, external scripts, external stylesheets,
parent-page access, persistent storage, or navigation. The sandbox blocks these
facilities; the optional checker reports maintained direct/static forms before
mounting. Runtime isolation remains authoritative.

Handle `genui.call()` failures and render a useful error state. Generated code
must not treat a rendered confirmation or button state as authorization.

## Host theming

Hosts may provide any subset of the MCP Apps SEP-1865 design tokens from the
2026-01-26 specification below, or provide none. Use a standardized token for
every visual property it covers: colors, font families, font weights, text and
heading sizes, line heights, borders, radii, focus rings, and shadows. Do not
hardcode those values directly. Hardcode only layout geometry, spacing, and
behavior for which no standardized token exists.

Reference every token through `var(--name, fallback)` with a sensible fallback
so the surface remains usable when a host omits it.

- Background colors: `--color-background-primary`,
  `--color-background-secondary`, `--color-background-tertiary`,
  `--color-background-inverse`, `--color-background-ghost`,
  `--color-background-info`, `--color-background-danger`,
  `--color-background-success`, `--color-background-warning`, and
  `--color-background-disabled`.
- Text colors: `--color-text-primary`, `--color-text-secondary`,
  `--color-text-tertiary`, `--color-text-inverse`, `--color-text-ghost`,
  `--color-text-info`, `--color-text-danger`, `--color-text-success`,
  `--color-text-warning`, and `--color-text-disabled`.
- Border colors: `--color-border-primary`, `--color-border-secondary`,
  `--color-border-tertiary`, `--color-border-inverse`,
  `--color-border-ghost`, `--color-border-info`, `--color-border-danger`,
  `--color-border-success`, `--color-border-warning`, and
  `--color-border-disabled`.
- Ring colors: `--color-ring-primary`, `--color-ring-secondary`,
  `--color-ring-inverse`, `--color-ring-info`, `--color-ring-danger`,
  `--color-ring-success`, and `--color-ring-warning`.
- Font families: `--font-sans` and `--font-mono`.
- Font weights: `--font-weight-normal`, `--font-weight-medium`,
  `--font-weight-semibold`, and `--font-weight-bold`.
- Text sizes: `--font-text-xs-size`, `--font-text-sm-size`,
  `--font-text-md-size`, and `--font-text-lg-size`.
- Heading sizes: `--font-heading-xs-size`, `--font-heading-sm-size`,
  `--font-heading-md-size`, `--font-heading-lg-size`,
  `--font-heading-xl-size`, `--font-heading-2xl-size`, and
  `--font-heading-3xl-size`.
- Text line heights: `--font-text-xs-line-height`,
  `--font-text-sm-line-height`, `--font-text-md-line-height`, and
  `--font-text-lg-line-height`.
- Heading line heights: `--font-heading-xs-line-height`,
  `--font-heading-sm-line-height`, `--font-heading-md-line-height`,
  `--font-heading-lg-line-height`, `--font-heading-xl-line-height`,
  `--font-heading-2xl-line-height`, and `--font-heading-3xl-line-height`.
- Border radii: `--border-radius-xs`, `--border-radius-sm`,
  `--border-radius-md`, `--border-radius-lg`, `--border-radius-xl`, and
  `--border-radius-full`.
- Border width: `--border-width-regular`.
- Shadows: `--shadow-hairline`, `--shadow-sm`, `--shadow-md`, and
  `--shadow-lg`.

Use `light-dark(light, dark)` for theme-aware color fallbacks. Keep token
resolution in CSS so a live host theme change updates the surface without
cached JavaScript values.

```html
<style>
  body {
    background: var(--color-background-primary, light-dark(#ffffff, #171717));
    color: var(--color-text-primary, light-dark(#171717, #f5f5f5));
    font-family: var(
      --font-sans,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif
    );
  }

  .card {
    border-radius: var(--border-radius-md, 8px);
    box-shadow: var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 12%));
  }
</style>
```

MCP Apps also permits host font CSS through `styles.css.fonts`. `genui` does not
accept or inject that field because `default-src 'none'` makes the effective
`font-src` policy `'none'` and the sandbox cannot load fonts from the network.
Use `--font-sans` and `--font-mono` with system font stacks as fallbacks.

## Isolation boundary

`mount()` creates an opaque-origin iframe with these attributes:

```html
<iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer">
```

The iframe document contains a UTF-8 declaration, the CSP below, an optional
trusted host-token `<style>` block, the trusted guest bootstrap, and then the
generated fragment. The trusted style and bootstrap appear before generated
content.

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

**Warning:** `https` and `https-and-data` open an outbound data channel. Guest
code can put any sandbox-visible value into an image URL path or query string.
`connect-src 'none'` does not block requests allowed by `img-src`, and
`referrerpolicy="no-referrer"` does not remove data placed in the image URL.

Keep the default `none` for surfaces that can see user, action-result, or other
sensitive data. `data` permits embedded images without an outbound request.
The current HTTPS policy is scheme-wide, not a domain allowlist; enable it only
when that exfiltration risk is acceptable.

The iframe boundary is the security control. Content filtering is not part of
the code/0 security model.

## Guest bridge

The bootstrap installs exactly this public API on `window.genui`:

```js
genui.surfaceId
genui.hostContext
genui.onHostContextChange(handler)
await genui.call(name, input)
await genui.subscribe(name, input, handler)
await genui.sendMessage(text) // optional
await genui.openLink(url) // optional
await genui.updateModelContext({ content?, structuredContent? }) // optional
genui.snapshot(fn)
genui.teardown(handler)
```

`genui.surfaceId` is the current surface ID. The generation contract supplies
the complete selected action and subscription names, types, and schemas. The
guest bridge does not expose descriptor collections or a discovery API.

Call only names declared in the generation contract. The trusted host still
reauthorizes each request against the current surface grant. Handle
`not_granted` like any other expected command failure because authority may
change after generation.

`genui.call(name, input)` posts a call carrying `surfaceId`, a unique `callId`,
the action name, and input. It resolves to the successful action output. It
rejects with `GenuiActionError { code, message }` for an action error.

Results correlate by `callId`. Unknown and duplicate result messages are
ignored. Result, subscription-delivery, host-context, snapshot-request, and
teardown-request messages are accepted only through native browser delivery
from the iframe's parent window with the matching channel, surface ID, and
current-document scope. Synthetic guest-dispatched message events are ignored.
Generated code cannot change the host or kernel grant.

### Subscriptions

Subscribe only to a name in the generation contract. Pass input matching its
schema and one event handler:

```js
try {
  const stream = await genui.subscribe(
    "orders.changes",
    { status: "processing" },
    async (event) => {
      await renderOrderChange(event)
    },
  )

  stopButton.onclick = () => stream.unsubscribe()
  stream.done.then((result) => {
    if (!result.ok) showStreamError(result.error)
  })
} catch (error) {
  showStreamError(error)
}
```

The initial `genui.subscribe()` Promise rejects with
`GenuiActionError { code, message }` when the request cannot open. A successful
open returns a frozen handle:

```ts
interface GenuiSubscriptionHandle {
  unsubscribe(): Promise<void>
  readonly done: Promise<
    | { readonly ok: true; readonly reason: "completed" | "unsubscribed" }
    | {
        readonly ok: false
        readonly error: { readonly code: string; readonly message: string }
      }
  >
}
```

`done` always resolves and never rejects. `unsubscribe()` is one-shot and
idempotent. It aborts only that handle. Source completion resolves with
`completed`; guest cancellation resolves with `unsubscribed`.

Events arrive in sequence order and at most once within one mounted
subscription. A handler may return a Promise. The bootstrap waits for it before
acknowledging the event, and the broker permits only one unacknowledged event
per subscription. The handler has five seconds to settle. If it throws or
rejects, the bootstrap emits `guest_error`, cancels that subscription, and
resolves `done` with `handler_failed`; the surface and other subscriptions stay
live.

At most four subscriptions may be active per surface. Input and each validated
event may be at most 64 KiB after UTF-8 JSON serialization. The browser broker
also limits aggregate delivery to ten events per second per surface. It does
not silently drop or coalesce events when delivery falls behind.

Stable subscription failure codes are `unknown_surface`, `not_granted`,
`blocked`, `invalid_input`, `rate_limited`, `storage_unavailable`,
`source_failed`, `invalid_event`, `event_too_large`, `revoked`, `expired`,
`not_available`, `handler_failed`, `ack_timeout`, `overflow`, and
`transport_failed`.

Replacement cancels every subscription from the old document, including
same-surface replacement. Snapshot restoration never restores a live handle.
There is no automatic reconnect, replay, or durable cursor in v0. Generated
code must not create a direct `WebSocket`, `EventSource`, or other network
connection; trusted host and server adapters own the source and transport.

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

### Host context

`genui.hostContext` is available before top-level guest code runs. It is a
deeply frozen snapshot with any host-provided `theme`, `containerDimensions`,
`locale`, `timeZone`, and `platform` fields. A host may omit any field. Trusted
`styles` are applied through CSS custom properties and are deliberately not
exposed through this JavaScript object.

Register one live-update handler with `genui.onHostContextChange(handler)`. A
later registration replaces the previous handler. The callback receives the
deeply frozen partial update. Before it runs, `genui.hostContext` has already
merged that update, so render from the accessor when the UI needs the complete
current context:

```html
<time id="local-date"></time>
<script type="module">
  const dateOutput = document.querySelector("#local-date")

  const renderEnvironment = () => {
    const {
      locale = "en-US",
      timeZone = "UTC",
      platform = "web",
    } = genui.hostContext

    dateOutput.textContent = new Intl.DateTimeFormat(locale, {
      timeZone,
    }).format(new Date())
    document.documentElement.dataset.platform = platform
  }

  genui.onHostContextChange(() => renderEnvironment())
  renderEnvironment()
</script>
```

Always pass the selected locale and time zone explicitly to `Intl` formatters.
The opaque iframe's browser defaults are not the user's declared preferences.
Use `platform` only for small interaction or layout adaptations instead of
user-agent sniffing; it grants no authority and is not a security signal.

Each dimension axis is independent. A `width` or `height` is fixed and owned by
the host. A `maxWidth` or `maxHeight` lets content size that axis up to the host
limit. Use responsive CSS in both modes and keep content usable inside fixed
dimensions. Do not attempt to resize or navigate the parent page; the bootstrap
reports content size to the host automatically.

Omitted or `undefined` update fields leave current values unchanged.
`containerDimensions` replaces the whole dimensions object when supplied.
Handler throws and rejected promises emit `guest_error` after the valid update
has been applied; they do not roll it back.

### Graceful teardown

`genui.teardown(handler)` registers one cleanup handler. A later registration
replaces the previous one, like `genui.snapshot(fn)`. The handler receives
`{ reason }`; the reason may be `undefined`. It may return a Promise.

When the host requests teardown, the bootstrap awaits the handler and then
calls the current snapshot provider to capture final state. Keep cleanup fast
and synchronous where possible. The host proceeds after its deadline even if
the handler never settles.

Handler or provider failures emit `guest_error`. The guest still acknowledges
teardown, but no final snapshot is returned. A guest with no handler or state
provider also acknowledges immediately.

Use `pagehide` only as an abrupt-removal fallback. Work started there cannot
extend the host's teardown deadline.

Genui deliberately combines the teardown acknowledgment and final snapshot in
one round-trip. MCP Apps `ui/resource-teardown` returns an empty result and has
no equivalent state-capture contract.

### Host capabilities

The bootstrap defines a host-capability method only when the current host
supplies its handler. The methods mirror MCP Apps `ui/message`, `ui/open-link`,
and `ui/update-model-context` semantics.

```js
if (typeof genui.sendMessage === "function") {
  sendButton.hidden = false
}
```

Feature-detect the method before rendering its control. Each method returns a
`Promise<void>` and may still be denied. Catch the rejection, restore the
control's pending state, and show a useful message.

`genui.sendMessage(text)` asks the host to add one user-role text message to
the conversation. The host receives `{ role: "user", content: { type: "text",
text } }`. This request may trigger a model follow-up.

`genui.openLink(url)` asks the host to open an external URL. The URL must be a
valid absolute `https:` URL. Relative URLs and every other scheme are rejected
before the host handler runs.

`genui.updateModelContext({ content?, structuredContent? })` sends a snapshot
of UI state for future model turns without triggering an immediate follow-up.
Later updates replace earlier state. Unlike MCP Apps, where `content` is a
`ContentBlock[]`, code/0 accepts one plain string because its guest bridge has
no content-block type. `structuredContent` is a record.

Successful calls resolve without a value. Host handler return values are never
sent into the sandbox. Failures reject with
`GenuiActionError { code, message }`. The capability-specific codes are:

- `invalid_input` for malformed input, a non-HTTPS link, or an oversized
  payload.
- `denied` when the advertised host handler rejects.
- `rate_limited` when another non-coalescing call to that capability is still
  pending.

`sendMessage` text and the JSON-serialized `updateModelContext` payload may
each be at most 16 KiB in UTF-8. A payload exactly at the limit is accepted;
one byte over is rejected before reaching the host.

Only one host request per capability and surface is in flight. A second
`sendMessage` or `openLink` call rejects with `rate_limited`. Model-context
updates use a last-write-wins queue instead: while one update runs, the newest
update replaces the one queued behind it. A superseded queued call resolves
successfully without reaching the host, and the latest queued value runs after
the active handler settles.

Replacement and disposal forget pending capability requests. A host handler
may still finish, but its late result is dropped when the document revision no
longer matches. Guest-posted result messages and results carrying a stale
surface ID are ignored.

During graceful teardown, action, subscription, and host-capability traffic
remains live until the final acknowledgment or deadline disposes the mount.
Final disposal aborts subscriptions and drops later results or events.

## Host enforcement

The host broker rejects action calls and subscription starts missing from the
surface grant before transport. The kernel independently reloads the surface
record, checks current policy and grant, validates input, and starts app-owned
code. It rechecks subscription authority and validates every event before
delivery; the initial grant does not authorize an indefinite stream.

Render consent UI in trusted host code. Display the supplied intent instead of
reconstructing approval text from raw guest input. Render it as plain text.
Canonical validation does not make interpolated strings trustworthy prose;
they can still contain manipulative instructions. Keep the fixed action and
consequence visually distinct from interpolated values, and never render an
intent with `innerHTML`.

## Errors, navigation, and liveness

The bootstrap forwards `window.onerror` and `unhandledrejection` as
`guest_error` events with a message and a stack when available. Handle these in
the `onEvent` callback passed to `mount()` and make them visible or send them
back to the generating model.

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
