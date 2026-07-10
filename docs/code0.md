# code/0 surfaces

Use `code/0` when a model should author an interactive HTML and JavaScript
fragment. The fragment runs as code, not as a template language.

Treat the dialect identifier as the wire version. The current contract is
`code/0`; npm package versions do not replace it.

```ts
import { codeDialect } from "genui/protocol"

const surface = await genui.surface({
  dialect: codeDialect,
  content: generatedFragment,
  actions: ["orders.search", "orders.update_status"],
})
```

The runtime stores `content` verbatim. It does not sanitize, rewrite, compile,
or resolve dependencies in the fragment. Grant projection still removes
unknown, blocked, duplicate, and confidential actions. Use
`genui.diagnostics(surface.id)` to inspect projection decisions.

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

## Host theming

Hosts may provide any subset of the MCP Apps SEP-1865 design tokens from the
2026-01-26 specification below, or provide none. Prefer these tokens over
invented colors, dimensions, shadows, and fonts. Use every token through
`var(--name, fallback)` with a sensible fallback so the surface remains usable
when a host omits it.

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
genui.actions
await genui.call(name, input)
genui.snapshot(fn)
```

`genui.surfaceId` is the current surface ID. `genui.actions` is the grant
snapshot embedded by the trusted host before generated content. It is
available to top-level guest scripts without waiting for an event. Each
descriptor contains `name`, `description`, `effect`, `confidentiality`, and
`requiresApproval`, plus optional `intent` and `inputSchema` fields.

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
output.

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
