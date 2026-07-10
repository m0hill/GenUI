# genui

`genui` provides the capability kernel and browser host for generated
code surfaces.

Import serialized wire types and codecs from `genui/protocol`.
Verify shared `SurfaceStore` adapters with `genui/testing`.

Define one-shot authority with `action()` and read-only event authority with
`subscription()`. Create one `Genui` instance to project per-surface grants,
persist authoritative surface records, validate calls and every subscription
event, apply policy and approval, and run app-owned code.

Generated content is ordinary fragment HTML with inline JavaScript. The
runtime stores it verbatim. `mount()` runs it in an opaque-origin iframe with a
network-denying CSP. Its trusted `window.genui` bridge exposes granted action
calls and subscriptions, optional host capabilities and context, state
snapshots, and lifecycle hooks without exposing the parent page or a network
connection.

Security comes from isolation and trusted-side enforcement:

- The iframe receives only its projected grant.
- The browser broker rejects ungranted calls before transport.
- The kernel reloads the surface record and rechecks policy and grant before
  action execution and every subscription event.
- Input is validated before authoritative approval and execution.
- Every subscription event is validated, size-bounded, and delivered with
  bounded backpressure.
- Sensitive actions and subscriptions never enter generated-code grants.
- Internal failures reach an optional trusted `onError` hook without crossing
  the guest boundary.

Read [the action guide](../../docs/actions.md), [subscription
guide](../../docs/subscriptions.md), [code surface contract](../../docs/code0.md),
and [hosting guide](../../docs/hosting.md) for the supported APIs and integration
rules.
