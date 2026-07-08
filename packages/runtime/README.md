# @hono-ai/genui

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
names.

`Surface.dialect` is a versioned protocol identifier, not a plugin interface. This
package currently ships the concrete `genui/0` sanitizer, instructions, and sandbox
asset. A future dialect should ship as its own concrete module and sandbox asset selected
by dialect id.
