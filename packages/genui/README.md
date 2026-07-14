# genui

`genui` provides the capability kernel and browser host for generated
code surfaces.

Import serialized wire types and codecs from `genui/protocol`.
Install the server-side [`@genui/check`](../check/README.md) package separately
to check generated fragments before surface creation.
Verify shared `SurfaceStore` adapters with `genui/testing`.

Define one-shot authority with `action()` and read-only event authority with
`subscription()`. Create one `Genui` instance to project per-surface grants,
persist authoritative surface records, validate calls and every subscription
event, apply policy and approval, and run app-owned code.

Validators that implement Standard JSON Schema V1 automatically provide their
model-facing input and output contracts. Explicit JSON Schema remains available
as an override for validators that cannot derive it.

Select definitions once with `genui.generation()`. The resulting generation
produces the model's stable environment guidance and selected capability
contract, then creates surfaces from that same selection while reapplying
current policy.

`@genui/check` parses inline module scripts and checks them against the selected
generation contract. It returns bounded diagnostics for a model retry but never
replaces authoritative surface creation or runtime validation.

Run `nub run test:reliability` in this repository to exercise the retained
checker-to-browser corpus. Its authority scenario checks and mounts a fragment,
then revokes the Surface before interaction and verifies that the kernel denies
the call.

Generated content is ordinary fragment HTML with inline JavaScript. The
runtime stores it verbatim. `mount()` runs it in an opaque-origin iframe with a
network-denying CSP. Its trusted `window.genui` bridge exposes granted action
calls and subscriptions, optional host capabilities and context, state
snapshots, and lifecycle hooks without exposing the parent page or a network
connection.

Every Surface is limited to 102,400 UTF-8 bytes. Import
`maxSurfaceContentBytes` from `genui/protocol` for host-side byte accounting.
Creation, protocol parsing, store re-entry, mount, and replacement all fail
closed on oversized content and never truncate it.

Security comes from isolation and trusted-side enforcement:

- The iframe receives only its projected grant.
- The browser broker rejects ungranted calls before transport.
- The kernel reloads the surface record and rechecks policy and grant before
  action execution and every subscription event.
- Checker acceptance and an earlier mounted grant never preserve revoked
  authority.
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
