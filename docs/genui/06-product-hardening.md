# Product Hardening

## Threat Model

The system should assume:

- model output may be hostile;
- tool results may contain hostile text;
- user prompts may be adversarial;
- old generated surfaces may be replayed after policy changes;
- a client may be modified;
- an iframe may request unleased capabilities;
- a trusted runtime dependency may have bugs;
- a user may approve a bad action;
- a generated surface may try to mislead the user visually.

The system should not assume the model "knows better" because the prompt says so.

## Required Defenses

Core defenses:

- sanitize generated HTML;
- isolate it in a sandbox;
- keep the host page policy strong;
- use a narrow message protocol;
- verify message source;
- check the per-surface lease;
- check the global registry;
- validate inputs server-side;
- validate outputs when practical;
- require approval for writes;
- bind approval to exact requests;
- rate-limit capability calls;
- audit side effects;
- re-sanitize persisted UI on restore.

These defenses overlap intentionally.

## Residual Risks

No architecture makes arbitrary generated UI perfectly safe.

Remaining risks include:

- phishing-like UI inside the sandbox;
- misleading labels;
- confusing approval copy;
- excessive DOM size;
- CSS that hides or occludes content;
- slow expressions;
- runtime bugs;
- browser sandbox bugs;
- dependency compromise;
- users approving harmful actions.

Mitigation is a product discipline, not just a code discipline.

## Approval UX

Approval should be a real product surface, not a browser confirm dialog.

Good approval UI should show:

- capability name;
- human description;
- effect level;
- destination account or integration;
- exact input preview;
- expected outcome;
- approve, deny, and possibly edit actions.

Approval should be resumable. The capability request should wait, not disappear. The user decision should be auditable.

For write and dangerous capabilities, approval should be verified on the server.

## Observability

Generated UI needs inspection.

Each generated surface should be able to show or expose:

- creation time;
- source agent turn;
- requested capabilities;
- granted lease;
- sanitized removals;
- capability call history;
- pending requests;
- errors;
- approvals;
- state snapshot.

This is useful for development, support, security review, and user trust.

## Testing

Testing should cover each boundary.

Sanitizer tests should verify that unsafe elements, attributes, URLs, forms, expressions, unregistered actions, and unleased capability calls are removed.

Registry tests should verify that invalid names fail, duplicates fail, blocked capabilities disappear, unknown requests fail, schema-invalid inputs fail, and approval policy is enforced.

Host broker tests should verify that unknown frames are ignored, resize is clamped, unsafe links are blocked, unleased capabilities fail, and approval denial is handled.

Browser tests should verify rendering, interaction, pending state, success state, error state, approval flow, restoration, and layout at multiple viewport sizes.

## Product Quality

Generated UI should feel like a serious product surface.

The framework should support:

- consistent base styles;
- accessible controls;
- loading states;
- error states;
- empty states;
- safe links;
- visible provenance for external data;
- compact but readable layouts;
- surface-level dismissal or reset;
- capability inspection.

Generated UI quality is not only a model issue. It is also a runtime and design-system issue.

## Production Roadmap

The highest-value production improvements are:

1. Move from browser confirm to server-backed approval records.
2. Bind generated surfaces to server-side records and manifest hashes.
3. Support multiple concurrent capability calls with named result targets.
4. Add a shared state protocol.
5. Add an MCP-to-capability adapter.
6. Add trusted widgets for charts, tables, maps, previews, and editors.
7. Self-host trusted runtime dependencies.
8. Add a capability inspector.
9. Add policy-aware persistence and restoration.
10. Add rate limits and audit logs for every side-effecting capability.

## Product Decision Tests

Before exposing a new capability to generated UI, ask:

- Can a user understand what this capability does?
- Is the input small enough to preview?
- Is the output stable enough to render?
- What is the worst misuse?
- Does it need approval?
- Does it need a server-side checkpoint?
- Can it be rate-limited?
- Can it be audited?
- Is it narrower than the raw agent tool?
- Would this still be safe if the generated UI lies about what the button does?

That last question is important. The runtime must protect the user even when the generated interface is misleading.

