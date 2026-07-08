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

## Templating Position

The model is the template engine. It authors concrete HTML for each surface, so the
dialect should not grow a general templating system for reuse, abstraction, partials,
includes, or components.

Templating belongs in the runtime only where the model cannot know cardinality at
generation time: repeating over runtime data that arrives later from state or a
capability result. That is the boundary for `data-genui-each`.

Accepted shape:

- `data-genui-each="$orders.value.items"` names the array to render.
- `data-genui-as="order"` names the item scope; when omitted, the runtime uses `$item`.
- The element's children are the template. The runtime clones them into one instance per
  item and clears/rebuilds the list on refresh.
- Nested `data-genui-each` is valid. Inner scopes merge with outer scopes, so an action
  can read both `$order.id` and `$line.id`.
- Scope is a state-read overlay, not a state write. `$order` and `$line` do not get
  written into shared surface state.
- Event-time scope recovery is part of the design. Delegated click/submit handlers use
  the rendered element scope so row actions can build capability inputs from item data.
- Capability results stay data-only. The runtime repeats existing sanitized markup over
  data; capabilities do not return display HTML.
- Whole-list rerender is the current rule. Keyed diffing can come later only if real app
  behavior needs it.

Explicitly rejected for now:

- Text interpolation such as `{{ order.name }}`. Dynamic behavior should stay in
  allowlisted attributes such as `data-genui-text`, where the sanitizer can reason about
  it.
- Named or reusable templates, partials, includes, and model-authored components. Reuse
  helps human authors more than generated surfaces, and it adds a resolution layer the
  sanitizer and runtime would need to trust.
- Structural `if`/`else` templating. `data-genui-show` covers conditional display, and
  the model can author both branches concretely.
- Recursive template references. They are abstraction, not runtime-data cardinality.

Future exception to keep in mind: host-defined templates or trusted widgets. An app may
eventually register a blessed fragment such as an order card and let the model place it
inside a generated layout with data. That belongs to the deferred trusted-widget and
extension-model work, not to the current authored dialect.

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
- `data-genui-each`
- `data-genui-as`
- `data-genui-class`
- `data-genui-class-*`
- `data-genui-style`
- `data-genui-style-*`
- `data-genui-attr-*`

Static presentation CSS is allowed through normal inline `style` attributes after
sanitization. The sanitizer keeps known visual/layout properties and removes CSS that
can fetch external resources or uses unsupported properties. `<style>` tags and external
stylesheets remain outside the generated surface dialect.

Expression scope is intentionally small:

- state reads: `$name`, `$name.path`;
- array own-property reads such as `$orders.value.items.length`;
- primitive literals;
- equality and inequality comparisons;
- flat object literals for capability inputs and initial state.

Capability result state is stale-while-pending: when a target with an existing `value`
enters `status: "pending"`, the previous `value` remains readable so lists and details
do not disappear during refresh-style mutations.

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
   - Done in code: `data-genui-each` renders arrays with full rerender.
   - Done in code: `data-genui-as="order"` creates item scope for `$order.id`.
   - Done in code: nested `data-genui-each` blocks merge outer and inner scopes, so
     actions can read values like `$order.id` and `$line.id` together.
   - Done in code: item-scoped capability inputs work, for example `{ id: $order.id }`.
   - Done in code: array `.length` reads work for empty states such as
     `$orders.value.items.length == 0`.
   - Done in code: `data-genui-bind` is stripped inside repeated templates because
     editable row semantics are not defined yet.
   - Capability results stay data-only; no browser-side HTML fragments are introduced.

4. Real app proof.
   - Done in code: an orders-admin proof test defines app-owned schemas, capabilities,
     state, and a generated orders surface outside the runtime internals.
   - Done in code: `orders.search` is a read capability.
   - Done in code: `orders.refund` is an approval-gated write capability.
   - Done in code: `orders.add_note` is a write capability.
   - Done in code: the proof surface includes a filter form, empty/pending/error state,
     a repeated result table, nested line items, per-row actions, and mutation refresh
     behavior.
   - Done in code: the same HTML with a narrower grant refuses the write action before
     transport.
   - Follow-up: add a visual example route or standalone example app once the public
     mount API settles further.

5. Surface storage.
   - Done in code: `createRegistry` accepts a pluggable `SurfaceStore`.
   - Done in code: `createSurface` is async so real persistence can be used without
     pretending storage is always in-process memory.
   - Done in code: the package exports `createMemorySurfaceStore` as the default local
     implementation.
   - Done in code: execution can run from another registry instance using the same store,
     which makes `Surface` serialization honest across process boundaries.

6. DOM API hardening.
   - Done in code: browser transport receives `{ signal }` so app transports can cancel
     capability work when a mounted surface is replaced or disposed.
   - Done in code: pending capability results are aborted and dropped on replacement,
     including same-surface-id replacement.
   - Done in code: `SurfaceInstance.update()` has been renamed to `replace()` because it
     recreates the sandbox document and destroys sandbox state.

## Important Deferred Work

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
- `<template data-genui-each>` support.
- Text interpolation and named model-authored templates.

## Explicit Non-Goals For Now

- Do not build a provider adapter before the browser/runtime loop proves itself.
- Do not make app-defined directive plugins yet; every sanitizer-allowed directive is a
  runtime contract.
- Do not add capability-returned HTML fragments before solving browser-side sanitization.
- Do not add general templating. Repetition over runtime data is the only templating
  construct in the authored dialect.
- Do not couple the runtime to React, Hono, Datastar, Datastar Kit, AI SDK, Pi, OpenAI,
  or MCP.

## Open Questions

- Should `@set('state.path', value)` be complemented by `@toggle('state.path')`?
- Should `Effect` keep `"local"`, or should local behavior be represented only by
  dialect actions that never leave the sandbox?
- When is `<template data-genui-each>` worth adding over the current host-element
  template model?
- What is the right explicit row-editing model if repeated rows eventually need local
  editable form state?
- What is the minimum persistence API that makes `Surface` restoration honest without
  overcommitting to storage semantics?
