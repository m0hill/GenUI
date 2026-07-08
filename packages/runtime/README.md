# @hono-ai/genui-runtime

Provider-independent generated UI runtime.

The v0 slice is intentionally small: app-defined capabilities go into a registry, the
registry creates sanitized surfaces under explicit grants, and every capability call is
enforced against that surface grant before application code runs.

Capability `effect` values describe authority outside the sandbox: `read`, `write`, or
`dangerous`. Purely local interface behavior belongs to the `genui/0` dialect, for
example `@set('state.path', value)`, and is not represented as a capability effect.

Approval can be checked in two places. `mountSurface({ approve })` is host-side UX: it
can ask before forwarding a request from the iframe. `registry.execute(..., { approve })`
is authoritative application policy and must be used for any approval-gated capability
when the transport reaches the server or trusted app boundary.

Surface source is preserved in the app's `SurfaceStore`. Use
`registry.reprojectSurface(surfaceId)` to re-sanitize a stored surface under the current
capability policy while preserving its id, and `registry.surfaceDiagnostics(surfaceId)`
to inspect requested, granted, and dropped capability names.

`Surface.dialect` is a versioned protocol identifier, not a plugin interface. This
package currently ships the concrete `genui/0` sanitizer, instructions, and sandbox
asset. A future dialect should ship as its own concrete module and sandbox asset selected
by dialect id.
