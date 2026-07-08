# @genui/genui

Provider-independent generated UI runtime.

The v0 slice is intentionally small: app-defined actions go into `new Genui()`, the
runtime creates sanitized surfaces under explicit grants, and every action call is
enforced against that surface grant before application code runs.

Actions are capability-style grants: generated UI requests named authority, and the app
decides what each surface actually receives.

Action `effect` values describe authority outside the sandbox: `local`, `read`, `write`,
or `dangerous`. Purely local interface behavior usually belongs to the `genui/0` dialect,
for example `@set('state.path', value)`, but host-executed local actions can also be
declared when they must cross the sandbox boundary.

Approval can be checked in two places. `mount(..., { confirm })` is host-side UX: it
can ask before forwarding a request from the iframe. `genui.execute(..., { approve })`
is authoritative application policy and must be used for any approval-gated action
when the transport reaches the server or trusted app boundary.

Surface source is preserved in the app's `SurfaceStore`. Use `genui.reproject(surfaceId)`
to re-sanitize a stored surface under the current action policy while preserving its id,
and `genui.diagnostics(surfaceId)` to inspect requested, granted, and dropped action
names plus sanitized HTML drops such as stripped elements, attributes, and invalid
directives.

The sanitizer is allowlist-based. It keeps known HTML elements, a conservative set of
static attributes, safe inline style declarations, and `genui/0` directives. Unsupported
elements or attributes are removed and reported through diagnostics.

`Surface.dialect` is a versioned protocol identifier, not a plugin interface. This
package currently ships the concrete `genui/0` sanitizer, instructions, and sandbox
asset. A future dialect should ship as its own concrete module and sandbox asset selected
by dialect id.

Mounted surfaces can snapshot their sandbox state. `instance.snapshot()` returns JSON
state from the iframe, and `await instance.replace(surface)` uses that same protocol for
same-surface regeneration so drafts, selected filters, result data, and keyed row-local
state survive conversational UI iteration. Cross-surface replacement does not auto-carry
state; pass `replace(surface, { snapshot })` when the host intentionally wants that.
Scroll is host-owned in the auto-height iframe model and is intentionally not part of the
snapshot.

Images are blocked by default with `img-src 'none'`. Hosts may opt into `imagePolicy:
"data"`, `"https"`, or `"https-and-data"` when a surface should render images. Runtime
expression failures such as invalid formatter inputs emit `violation` events with reason
`runtime_expression` so model repair loops can see post-mount failures. Missing loading
state renders empty or hidden without a violation; malformed present values are reported.
