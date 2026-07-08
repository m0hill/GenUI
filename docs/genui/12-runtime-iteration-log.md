# Runtime Iteration Log

This document tracks the runtime work that is still open, the advice we have received,
and the current sequencing decisions. It is intentionally practical: update it whenever
we accept, reject, or defer a major runtime idea.

## Current Direction

The runtime is a provider-independent generated UI primitive.

The center of gravity is:

- `Surface`: sanitized, serializable HTML plus grant metadata;
- `Grant`: the per-surface visible action set;
- `Action`: app-defined authority with input/output schemas;
- `mount`: browser host that isolates the surface and brokers calls;
- `genui/0`: a small authored HTML dialect using `data-genui-*` directives.

Generated UI should remain HTML-first. The model authors markup and directives; app
authority stays behind brokered actions.

## Templating Position

The model is the template engine. It authors concrete HTML for each surface, so the
dialect should not grow a general templating system for reuse, abstraction, partials,
includes, or components.

Templating belongs in the runtime only where the model cannot know cardinality at
generation time: repeating over runtime data that arrives later from state or an action
result. That is the boundary for `data-genui-each`.

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
  the rendered element scope so row actions can build action inputs from item data.
- Action results stay data-only. The runtime repeats existing sanitized markup over
  data; actions do not return display HTML.
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

- Keep `Surface + Grant + Action + mount` as the core framework primitive.
- Prefer a closed GenUI dialect over Datastar-compatible terminology or behavior.
- Add local actions so ordinary UI state does not require a server round trip.
- Prefer `data-genui-each` over action-returned HTML fragments for the next major
  list/result-rendering feature.
- Keep action results data-only until there is a browser-side sanitizer story.
- Make result-state instructions explicit so models can render pending/success/error
  states without guessing.
- Rename submit handling to `data-genui-on-submit`; native submit is already blocked by
  the sandbox document.
- Eventually make surface storage pluggable so `genui.execute` is honest in
  multi-process and serverless hosts.
- Treat broker approval as UX and registry approval as authoritative application policy.
- Add `AbortSignal` to browser transports before external consumers depend on the
  transport signature.
- Name replacement as `Mounted.replace()` because it destroys iframe state.

## Sandbox Asset Position

The generated sandbox asset is checked in as TypeScript because it is a typed module that
exports a JavaScript string. The authored runtime remains normal TypeScript modules; the
generated file is the bridge between those modules and the inline script injected into the
iframe document.

Accepted rules:

- Keep author-owned sandbox code in readable TypeScript modules.
- Generate `sandbox-asset.generated.ts` from the sandbox entrypoint.
- Minify the bundled JavaScript inside that generated asset because it is injected into
  every mounted surface iframe.
- Do not minify ordinary TypeScript source or public package source; downstream package
  builds and app bundlers own that.
- Do not generate source maps inside the iframe asset yet. They add CSP and network
  behavior without enough debugging value at this stage.

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
- flat object literals for action inputs and initial state.

Action result state is stale-while-pending: when a target with an existing `value`
enters `status: "pending"`, the previous `value` remains readable so lists and details
do not disappear during refresh-style mutations.

Supported event actions:

- `@action('name', input)`;
- `@action('name', input, { target: 'resultName' })`;
- `@capability('name', input)` and target variants are accepted as legacy spellings;
- `@set('state.path', value)`.

## Next Commits

1. Result instruction fidelity.
   - Done in code: result state is now documented in `genui0Instructions`.
   - Done in code: `data-genui-on-submit-prevent` has been renamed to
     `data-genui-on-submit`.

2. Local actions.
   - Done in code: `@set('state.path', value)` updates local surface state without
     calling a brokered action.
   - Done in code: sanitizer, language, generated sandbox parser, sandbox runtime, and
     instruction coverage all understand `@set`.
   - Follow-up: consider a dedicated `@toggle('state.path')` if boolean toggles are too
     verbose with explicit `@set` calls.

3. List rendering.
   - Done in code: `data-genui-each` renders arrays with full rerender.
   - Done in code: `data-genui-as="order"` creates item scope for `$order.id`.
   - Done in code: nested `data-genui-each` blocks merge outer and inner scopes, so
     actions can read values like `$order.id` and `$line.id` together.
   - Done in code: item-scoped action inputs work, for example `{ id: $order.id }`.
   - Done in code: array `.length` reads work for empty states such as
     `$orders.value.items.length == 0`.
   - Done in code: `data-genui-bind` is stripped inside repeated templates because
     editable row semantics are not defined yet.
   - Action results stay data-only; no browser-side HTML fragments are introduced.

4. Real app proof.
   - Done in code: an orders-admin proof test defines app-owned schemas, actions,
     state, and a generated orders surface outside the runtime internals.
   - Done in code: `orders.search` is a read action.
   - Done in code: `orders.refund` is an approval-gated write action.
   - Done in code: `orders.add_note` is a write action.
   - Done in code: the proof surface includes a filter form, empty/pending/error state,
     a repeated result table, nested line items, per-row actions, and mutation refresh
     behavior.
   - Done in code: the same HTML with a narrower grant refuses the write action before
     transport.
   - Follow-up: add a visual example route or standalone example app once the public
     mount API settles further.

5. Surface storage.
   - Done in code: `new Genui({ store })` accepts a pluggable `SurfaceStore`.
   - Done in code: `genui.surface(...)` is async so real persistence can be used without
     pretending storage is always in-process memory.
   - Done in code: the package exports `memoryStore()` as the default local
     implementation.
   - Done in code: execution can run from another registry instance using the same store,
     which makes `Surface` serialization honest across process boundaries.

6. DOM API hardening.
   - Done in code: browser transport receives `{ signal }` so app transports can cancel
     action work when a mounted surface is replaced or disposed.
   - Done in code: pending action results are aborted and dropped on replacement,
     including same-surface-id replacement.
   - Done in code: `Mounted.replace()` is the public replacement API because it
     recreates the sandbox document and destroys sandbox state.

7. Public API hardening.
   - Done in code: `Effect` includes `local`, `read`, `write`, and `dangerous`.
   - Done in code: `MountOptions` now states the public DOM contract directly
     instead of extending the internal broker option shape.
   - Done in code: `@genui/genui/dom` no longer re-exports result-routing
     helpers as public API.
   - Done in code: `Genui` exposes `reproject(surfaceId)` so stored source can be
     re-sanitized under current action policy without changing the surface id.
   - Done in code: `Genui` exposes `diagnostics(surfaceId)` so app/model loops can
     inspect requested, granted, and dropped action names.
   - Done in code: projection diagnostics are recomputed from preserved source instead
     of cached, so policy changes are reflected before and after reprojection.
   - Done in docs: local-only UI behavior is represented by dialect actions such as
     `@set`, not by brokered actions.
   - Done in docs: broker approval is host-side UX; registry approval is authoritative
     application policy.

8. Approval lifecycle hardening.
   - Done in code: registry tests now assert approval-gated actions do not execute
     unless the authoritative registry approval callback returns `true`.
   - Done in code: broker tests now assert broker approval only gates forwarding, and an
     authoritative denial returned by transport still reaches the surface as
     `approval_denied`.

9. Concrete dialect module.
   - Done in code: `genui/0` exposes one concrete `genui0Dialect` object for sanitizer
     policy, sandbox directive behavior, directive attribute names, and model
     instructions.
   - Done in code: removed the speculative generic `SurfaceDialect` interface. There is
     only one dialect implementation, and `genui/0` semantics still co-vary with the
     bundled sandbox asset.
   - Done in code: the generic sanitizer no longer threads a dialect parameter through
     recursive walks; it calls concrete genui/0 policy functions directly.
   - Done in code: the sandbox runtime imports the concrete genui/0 language and directive
     renderer directly instead of accepting a pretend-pluggable dialect object.
   - Done in code: `mount` refuses surfaces whose `Surface.dialect` is not
     `genui/0`, which is the honest hook where a future dialect-id-to-asset lookup would
     live.
   - Done in docs: `Surface.dialect` is documented as a versioned protocol id, not a
     plugin interface. A future dialect should ship as a concrete module and sandbox asset
     selected by id.

10. Language interface unification.
    - Done in code: `genui0-language` now exports one shared `genui0Language` object
      instead of module-level wrapper aliases around a private singleton.
    - Done in code: the sandbox runtime imports `genui0Language` directly, so
      action/result types are no longer restated in the DOM module.
    - Done in code: the sandbox entry passes `genui0Language` directly instead of wrapping
      identical methods in adapter lambdas.
    - Done in code: sanitizer/dialect checks, result routing, and action-name
      validation call through the shared language object.

11. Result-state ownership.
    - Done in code: added one shared `result-state` module for pending, complete, and
      error result transitions.
    - Done in code: the sandbox runtime uses `pendingResultState`, including the
      stale-while-pending rule that preserves previous `value`.
    - Done in code: the broker uses `resultStateFromActionResult` for complete/error
      messages sent back into the sandbox.
    - Done in code: result target naming remains separate in `result-routing`.

12. Core lifecycle consolidation.
    - Done in code: removed the separate `surface-records` module.
    - Done in code: `surface-runtime` now owns surface record creation, copying,
      reprojection, diagnostics, and the default memory store.
    - Done in code: package-root `memoryStore` exposes the default in-memory store, and
      its implementation now lives with the surface lifecycle.
    - Done in code: removed the tiny result-helper module; the standard action error
      envelope constructor now lives next to `ActionResult`.

13. Shared source scanner.
    - Done in code: replaced duplicate quote/depth scanners in `genui0-language` and
      `css-style` with one internal `source-scanner` module.
    - Done in code: the scanner makes bracket behavior explicit: GenUI shallow object
      entries reject brackets, GenUI action arguments track `()[]{}`, and CSS tracks
      parentheses only.
    - Done in code: added focused scanner tests for quoted separators, empty-part
      handling, bracket-depth handling, and escape rejection.

14. Prototype-pollution regression coverage.
    - Done in code: object literal parsing rejects `__proto__` keys, including quoted
      keys.
    - Done in code: `constructor` and `prototype` object-literal keys are treated as
      own data fields.
    - Done in code: sandbox state reads/writes treat `constructor` and `prototype` as
      own state paths and do not traverse inherited object prototypes.
    - Done in code: invalid `@set('__proto__.path', value)` actions do not mutate
      `Object.prototype`.

15. Sanitizer diagnostics.
    - Done in code: `sanitizeSurfaceHtml(...)` now returns `{ html, dropped }` instead
      of only the sanitized string.
    - Done in code: HTML drops record the affected `node`, optional `attribute`, a
      truncated offending `value`, and a stable reason such as `forbidden_element`,
      `unsafe_url`, `ungranted_action`, `invalid_genui_expression`, or
      `unknown_genui_attribute`.
    - Done in code: `SurfaceRecord` stores projection diagnostics, and
      `Genui.diagnostics(surfaceId)` exposes both action grant diagnostics and
      `html.dropped` details for model repair loops.

16. Expression v0.5.
    - Done in code: the closed expression AST now supports ordering comparisons
      (`<`, `<=`, `>`, `>=`), unary `!`, boolean `&&`/`||`, and parenthesized grouping.
    - Done in code: display formatters are allowlisted as expression calls:
      `formatNumber(value)`, `formatCurrency(value, 'USD')`, `formatPercent(value)`,
      and `formatDate(value)`.
    - Done in code: `&&` and `||` use operand-returning semantics, so fallback display
      expressions like `$user.name || 'Guest'` render the fallback string instead of a
      boolean.
    - Done in code: model-facing instructions state that `formatPercent` takes a
      fraction and that ordering comparisons require matching types.
    - Done in code: sanitizer validation, sandbox evaluation, generated sandbox asset,
      and model-facing `genui/0` instructions were updated together.

## Important Deferred Work

- Model adapters.
- React wrapper.
- Streaming or partial-surface hydration.
- Plugin system for app-defined directives.
- Trusted widgets.
- Action-returned HTML fragments.
- Browser-side sanitizer.
- Keyed list diffing.
- `<template data-genui-each>` support.
- Text interpolation and named model-authored templates.

## Explicit Non-Goals For Now

- Do not build a provider adapter before the browser/runtime loop proves itself.
- Do not make app-defined directive plugins yet; every sanitizer-allowed directive is a
  runtime contract.
- Do not add action-returned HTML fragments before solving browser-side sanitization.
- Do not add general templating. Repetition over runtime data is the only templating
  construct in the authored dialect.
- Do not couple the runtime to React, Hono, Datastar, Datastar Kit, AI SDK, Pi, OpenAI,
  or MCP.

## Open Questions

- Should `@set('state.path', value)` be complemented by `@toggle('state.path')`?
- When is `<template data-genui-each>` worth adding over the current host-element
  template model?
- What is the right explicit row-editing model if repeated rows eventually need local
  editable form state?
- What is the minimum persistence API that makes `Surface` restoration honest without
  overcommitting to storage semantics?
