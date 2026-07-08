# Runtime Iteration Log

This document tracks the runtime work that is still open, the advice we have received,
and the current sequencing decisions. It is intentionally practical: update it whenever
we accept, reject, or defer a major runtime idea.

## Current Direction

The runtime is a provider-independent generated UI primitive.

The center of gravity is:

- `Surface`: sanitized, serializable HTML plus grant metadata;
- `Grant`: the per-surface visible capability set;
- `Capability`: app-defined authority with input/output schemas;
- `mountSurface`: browser host that isolates the surface and brokers calls;
- `genui/0`: a small authored HTML dialect using `data-genui-*` directives.

Generated UI should remain HTML-first. The model authors markup and directives; app
authority stays behind brokered capabilities.

## Accepted Big-Model Advice

The latest outside review agreed with the core primitive and recommended the following
changes before the API hardens:

- Keep `Surface + Grant + Capability + mountSurface` as the core framework primitive.
- Prefer a closed GenUI dialect over Datastar-compatible terminology or behavior.
- Add local actions so ordinary UI state does not require a server round trip.
- Prefer `data-genui-each` over capability-returned HTML fragments for the next major
  list/result-rendering feature.
- Keep capability results data-only until there is a browser-side sanitizer story.
- Make result-state instructions explicit so models can render pending/success/error
  states without guessing.
- Rename submit handling to `data-genui-on-submit`; native submit is already blocked by
  the sandbox document.
- Eventually make surface storage pluggable so `registry.execute` is honest in
  multi-process and serverless hosts.
- Treat broker approval as UX and registry approval as authoritative application policy.
- Add `AbortSignal` to browser transports before external consumers depend on the
  transport signature.
- Rename `SurfaceInstance.update()` to `replace()` because it destroys iframe state.

## Current `genui/0` Dialect

Supported directive shapes:

- `data-genui-state`
- `data-genui-bind`
- `data-genui-on-click`
- `data-genui-on-submit`
- `data-genui-show`
- `data-genui-text`
- `data-genui-class`
- `data-genui-class-*`
- `data-genui-style`
- `data-genui-style-*`
- `data-genui-attr-*`

Expression scope is intentionally small:

- state reads: `$name`, `$name.path`;
- primitive literals;
- equality and inequality comparisons;
- flat object literals for capability inputs and initial state.

Supported event actions:

- `@capability('name', input)`;
- `@capability('name', input, { target: 'resultName' })`;
- `@set('state.path', value)`.

## Next Commits

1. Result instruction fidelity.
   - Done in code: result state is now documented in `genui0Instructions`.
   - Done in code: `data-genui-on-submit-prevent` has been renamed to
     `data-genui-on-submit`.

2. Local actions.
   - Done in code: `@set('state.path', value)` updates local surface state without
     calling a capability.
   - Done in code: sanitizer, language, generated sandbox parser, sandbox runtime, and
     instruction coverage all understand `@set`.
   - Follow-up: consider a dedicated `@toggle('state.path')` if boolean toggles are too
     verbose with explicit `@set` calls.

3. List rendering.
   - Add a simple `data-genui-each` feature.
   - Start with full rerender, not keyed diffing.
   - Keep capability results data-only.
   - Make item-scoped capability input work, for example `{ id: $order.id }`.

4. Real app proof.
   - Build an orders-admin slice with:
     - `orders.search` as a read capability;
     - `orders.refund` as an approval-gated write capability;
     - `orders.addNote` as a write capability.
   - The surface should include a filter form, result table, per-row actions, pending
     state, error state, and mutation refresh behavior.

## Important Deferred Work

- Pluggable `SurfaceStore` for multi-instance hosts.
- `AbortSignal` in `mountSurface` transport.
- `SurfaceInstance.update()` rename to `replace()`.
- Clear approval lifecycle documentation and tests.
- Internal `SurfaceDialect` interface so future dialect versions have one owner.
- Prototype-pollution tests around state paths and object literal keys.
- Model adapters.
- React wrapper.
- Streaming or partial-surface hydration.
- Plugin system for app-defined directives.
- Trusted widgets.
- Capability-returned HTML fragments.
- Browser-side sanitizer.
- Keyed list diffing.

## Explicit Non-Goals For Now

- Do not build a provider adapter before the browser/runtime loop proves itself.
- Do not make app-defined directive plugins yet; every sanitizer-allowed directive is a
  runtime contract.
- Do not add capability-returned HTML fragments before solving browser-side sanitization.
- Do not couple the runtime to React, Hono, Datastar, Datastar Kit, AI SDK, Pi, OpenAI,
  or MCP.

## Open Questions

- Should `@set('state.path', value)` be complemented by `@toggle('state.path')`?
- Should `Effect` keep `"local"`, or should local behavior be represented only by
  dialect actions that never leave the sandbox?
- Should `data-genui-each` use a host element as the template, or should the sanitizer
  allow `<template data-genui-each>`?
- How should repeated item scope names be declared: `data-genui-as="order"`,
  `data-genui-item="order"`, or a fixed `$item`?
- What is the minimum persistence API that makes `Surface` restoration honest without
  overcommitting to storage semantics?
