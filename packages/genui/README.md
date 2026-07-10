# genui

`genui` provides the capability kernel and browser host for generated
code surfaces.

Import serialized wire types and codecs from `genui/protocol`.
Verify shared `SurfaceStore` adapters with `genui/testing`.

Define app actions with `action()`. Create one `Genui` instance to project
per-surface grants, persist authoritative surface records, validate calls,
apply policy and approval, execute app code, and validate outputs.

Generated content is ordinary fragment HTML with inline JavaScript. The
runtime stores it verbatim. `mount()` runs it in an opaque-origin iframe with a
network-denying CSP and exposes only `genui.call(name, input)` for external
effects.

Security comes from isolation and trusted-side enforcement:

- The iframe receives only its projected grant.
- The browser broker rejects ungranted calls before transport.
- The kernel reloads the surface record and rechecks policy and grant.
- Input is validated before authoritative approval and execution.
- Sensitive actions never enter generated-code grants.
- Internal failures reach an optional trusted `onError` hook without crossing
  the guest boundary.

Read [the action guide](../../docs/actions.md), [code surface
contract](../../docs/code0.md), and [hosting guide](../../docs/hosting.md) for
the supported APIs and integration rules.
