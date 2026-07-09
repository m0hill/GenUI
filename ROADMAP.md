# GenUI Roadmap

Written 2026-07-10. This file is the **single source of truth** for what to build,
in what order, how to test it, and how to commit it. The previous design docs
(`docs/genui/`) were deleted deliberately — they described an older architecture.
Do not resurrect them. Git history is reference material only.

If anything here conflicts with code comments, old commit messages, or your own
ideas about what would be cool: **this file wins.**

---

## 1. Goal

Build the safe substrate on which LLMs generate real, interactive web UI.

The end product is a small framework with one promise to host-app developers:

> Define your app's actions once — name, description, schema, effect, policy,
> intent — and any model-generated surface can use them, under isolation and
> authority rules the renderer cannot weaken.

The model authors an ordinary tiny web app (HTML + vanilla JS). It runs in a
locked sandbox (opaque-origin iframe, no network, no storage). The **only** door
out is `genui.call(name, input)` — a typed, granted, policy-checked, human-
approvable action pipeline enforced host/server-side.

What this project is **not**:

- Not a JSON component system.
- Not a custom template/expression language. (`genui/0` was that. It is being
  deleted in M5. Do not extend it, fix it, or imitate it.)
- Not a React framework, a build pipeline, or a design system.

## 2. Constitution

Every design decision is checked against these. If a change violates one,
don't make the change.

1. **Authority lives in the kernel, never in the renderer.** Every outside-world
   effect flows through a granted, schema-validated, policy-checked action
   enforced on the trusted side. If a design is only safe when the renderer
   behaves, the design is wrong.
2. **Isolation is a boundary, not a filter.** Safety comes from where generated
   code runs (opaque origin, no network, capability-only IO), not from
   constraining what it says. Sanitization is never a load-bearing security
   control.
3. **No ambient authority.** A surface can touch exactly what it was handed:
   per-surface, inspectable grants. Deny by default. A requested name is not a
   grant.
4. **Humans approve effects, not pixels.** Consent UI (intent template, effect
   class, input echo) is rendered by the trusted host from the grant and the
   **canonical, validated** input — never by the generated surface.
5. **Meet the model where it was trained.** HTML, plain JavaScript, and JSON
   Schema. No bespoke DSLs. Every line of custom instruction text is a tax.
6. **Define contracts once, derive everything else.** Validation, model-facing
   schemas, TypeScript types, approval previews, and codecs all come from the
   same action definition.
7. **Errors round-trip to the model.** Guest runtime errors, denied calls, and
   invalid inputs must reach the generating model in legible form. A silently
   dead button is a design defect.
8. **Small frozen center, replaceable edges.** Protocol and kernel stay tiny.
   Renderers, hosts, stores, transports are replaceable leaves.
9. **Complexity must pay rent.** A package, abstraction, or feature must
   measurably improve safe expressiveness or remove real user burden.

## 3. State of the repo today

- `packages/protocol` (`@genui/protocol`) — pure wire types + tiny helpers.
  Zero deps (there is a test enforcing this — keep it green). **Keep.**
- `packages/runtime` (`@genui/genui`) — contains two very different things:
  - **The kernel** (keep): `registry.ts` (action registry + `execute()`
    pipeline), `action-projections.ts` (grant projection),
    `surface-runtime.ts` (surface records, store), `schema.ts`, `types.ts`.
  - **The genui/0 dialect** (delete in M5): `src/dialect/**` (custom expression
    language, directive system, HTML sanitizer) and `src/dom/sandbox-runtime*`,
    `src/dom/sandbox-asset.generated.ts`, `scripts/build-sandbox-asset.mjs`
    (an in-iframe interpreter for that language). Roughly 5,000 lines. It works
    and its tests pass; it is being removed because it is a bespoke frontend
    framework that fights model training and buys no security the iframe
    doesn't already provide.
  - **The DOM host** (`src/dom/index.ts`, `surface-broker.ts`,
    `sandbox-message-schema.ts`, `protocol.ts`): iframe mounting + postMessage
    broker. **Keep the architecture**, rework for code mode in M3.
- There is currently **no example app**. The old Hono/Datastar chat example
  was deleted (git history has it) because it was heavyweight, carried genui/0
  residue, and needed model credentials to run. M4 builds a minimal playground
  host in its place. Until M4, end-to-end proof lives in the runtime's own
  browser tests.

Known kernel defects to fix (verified against source, see M1):

- `Genui.execute()` calls `approve()` **before** schema validation
  (`registry.ts`), so the human approves raw input while the action executes
  the parsed/transformed input. Violates constitution §4.
- Missing `policy` defaults to `"allow"` for **every** effect including
  `write` and `dangerous` (`action-projections.ts`). Violates §3.
- Public `Action` descriptors carry no input/output schemas, so models guess
  field names from prose. Violates §6.
- Result delivery ignores `callId`; two in-flight calls to the same target can
  land out of order. (Dies with genui/0 in M5; do not fix in the old runtime.)

## 4. Target architecture

Keep the current two packages until the shape stabilizes; split further only
when a real consumer needs it (§9). Internal layout:

```
@genui/protocol          wire types, JSON-Schema type, codecs (M2)
@genui/genui
  src/                   kernel: actions, grants, policy, execute, store
  src/dom/               host: mount(), broker, transport, approval hooks
  src/code/              code-mode guest: bootstrap script, instructions()
examples/playground      minimal proving-ground host (built in M4)
```

### The code/0 dialect

`Surface.dialect = "code/0"`. `Surface.content` is a model-authored HTML
fragment that may contain inline `<script type="module">` blocks. **No
sanitization.** The host wraps it in a document skeleton:

- iframe `sandbox="allow-scripts allow-forms"`, `referrerpolicy="no-referrer"`.
- CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src
  'unsafe-inline'; img-src <per host image policy>; connect-src 'none';
  frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- A small trusted **bootstrap script** injected *before* the generated content
  so `window.genui` exists when guest scripts run.

### The guest bridge API (pin this exactly)

```js
genui.surfaceId          // string
genui.actions            // Array<{ name, description, effect,
                         //         requiresApproval, intent?, inputSchema? }>
await genui.call(name, input)
  // resolves with the action's output value
  // rejects with GenuiActionError { code, message } (codes = ActionErrorCode)
```

That is the whole API. No nested proxies, no state helpers, no event system.
The bootstrap also installs `window.onerror` + `unhandledrejection` handlers
that post `{ type: "guest_error", message, stack }` to the host, which exposes
it via `onEvent` (constitution §7).

### Host-side enforcement (unchanged in spirit from today)

Guest `genui.call` → postMessage → broker checks the grant → host `confirm`
for `requiresApproval` actions → transport → server `Genui.execute()`
re-checks record, grant, policy, validates input, approves, executes,
validates output. The broker check is defense in depth; the server check is
authoritative.

There are two approval points; do not conflate them:

- **Client `confirm` (UX):** trusted host-page code shows the dialog before
  sending. It only has the raw call input (validation is server-side), so it
  renders `renderActionIntent(intent, rawInput)` as a best-effort preview.
- **Kernel `approve` (authoritative):** runs inside `execute()` **after**
  schema validation and receives the parsed canonical input (M1.1). How a
  host links its confirm UI to this hook is host policy — the playground
  simply forwards the client confirmation over its own trusted transport and
  its `approve` implementation honors it. The kernel-side test surface is
  what M1 certifies.

### Navigation tripwire

A sandboxed iframe can still navigate *itself* to an external URL — that is
the one egress channel CSP does not close. The host must treat any navigation
of the surface iframe after initial load as a violation: kill the iframe,
replace with an inert error state, emit `{ type: "violation", reason:
"navigation" }`. (Listen for a second `load` event on the iframe element.)

### Confidentiality tiers

Action definitions get an optional `confidentiality?: "normal" | "sensitive"`
(default `"normal"`). Sensitive actions are never granted to `code/0` surfaces
— dropped at projection with reason `"confidential"`. This is the protocol
hook that lets a stricter execution profile exist later without redesign.

## 5. Milestones

Work them **in order**. Each milestone ends with all checks green and one or
more commits. The tree must never be left broken between milestones (the only
allowed breakage is *within* M5, resolved before its final commit).

### M1 — Kernel correctness

1. Reorder `Genui.execute()`: resolve record → grant → policy → **validate
   input** → approve with the **parsed** input (change `ExecuteOptions.approve`
   to receive it) → execute → validate output.
2. Effect-derived policy defaults: `local`/`read` → `"allow"`, `write`/
   `dangerous` → `"ask"`. Explicit `policy` always wins.
3. Add `confidentiality` to `ActionDefinition` + protocol `Action`; projection
   drops sensitive actions from surface grants (new `DroppedActionReason:
   "confidential"`).

Acceptance: new tests prove (a) approval sees post-validation input, (b) a
`dangerous` action without explicit policy requires approval, (c) sensitive
actions never appear in a grant. All existing tests updated and green.

### M2 — Contracts and codecs in the protocol

1. `ActionDefinition` accepts optional `inputJsonSchema` / `outputJsonSchema`
   (plain JSON Schema objects, typed as `Readonly<Record<string, unknown>>`).
   The kernel gains no dependencies from this: callers project their validator
   to JSON Schema themselves (e.g. zod's `z.toJSONSchema`). Descriptors carry
   `inputSchema` when provided. (The kernel's only runtime deps stay
   `@genui/protocol` and — until M5 deletes it — `parse5`.)
2. Add runtime codecs to `@genui/protocol`: `parseSurface`, `parseActionCall`,
   `parseActionResult` — hand-written structural validators returning
   `T | undefined` (no dependencies). The dom broker/transport boundaries use
   them where applicable; the M4 playground must consume them instead of
   hand-rolled parsing.

Acceptance: codec round-trip tests (valid passes, each malformed field
rejects); protocol dependency-free test still green.

### M3 — The code/0 renderer

1. `src/code/bootstrap.ts`: the guest bridge (API above) as an embeddable
   string. Small enough to review in one sitting (< ~300 lines). Handshake:
   host posts the grant snapshot; `genui.call` posts
   `{ channel, surfaceId, callId, action, input }`, resolves on the matching
   `callId` result. Unknown/duplicate `callId` results are ignored.
2. `src/code/instructions.ts`: model-facing instruction text. Contents: the
   sandbox contract (fragment HTML + inline module scripts, no network, no
   external resources), the bridge API with one short worked example, and the
   granted action list **with their JSON Schemas**. This replaces the genui/0
   instruction blob.
3. Extend `src/dom/` mounting for `code/0`: skeleton document + CSP +
   bootstrap injection, broker reuse, navigation tripwire, guest-error
   events. Keep the existing `mount()` shape (`transport`, `confirm`,
   `onEvent`, `maxHeight`, `replace`, `dispose`). `mount()` dispatches on
   `surface.dialect`; the genui/0 path must keep working untouched until M5
   deletes it (§5 preamble: no breakage between milestones).
4. `Genui.surface()` for `code/0` stores content verbatim (grant projection
   still applies; no sanitizer). Wire the dialect id through protocol.

Acceptance: happy-dom unit tests for broker/tripwire logic; a real-browser
(Playwright, pattern in `src/dom/browser-boundary.test.ts`) test that mounts a
code surface which renders, calls a granted action, receives the result,
gets denied an ungranted action, and triggers the navigation tripwire.

### M4 — Build the playground host (`examples/playground`)

A deliberately small host app that proves the whole framework end-to-end
**without needing model credentials**. Plain Hono server + one
plain-HTML/vanilla-TS page. No Datastar, no Tailwind, no UI framework.
Smallness is a goal, not a budget — every feature beyond this list is out of
scope (§8).

1. Server: a demo action set (e.g. `orders.search` read, `orders.get` read,
   `orders.update_status` write with an `intent` template, one `sensitive`
   action to prove confidentiality dropping), one `Genui` instance, a
   `POST /genui/surface` endpoint that creates a surface from submitted
   content, and a `POST /genui/execute` endpoint that parses with the M2
   codecs.
2. Page: a textarea + "Create surface" button (**paste mode**) — paste any
   code/0 fragment, the server creates the surface, the page mounts it with
   the real `mount()`. This exercises mount → broker → confirm → transport →
   kernel with zero model involvement.
3. A "Copy model instructions" button that puts `instructions()` output (with
   granted action schemas) on the clipboard — the human loop: paste into any
   LLM chat, paste the generated fragment back into the playground.
4. Surface events (`guest_error`, violations, denied calls) render in a
   visible event log panel next to the surface — the error round-trip proof
   (constitution §7) — and are formatted so they can be pasted back to a
   model for repair.
5. Add a `dev` script wired at the workspace root, and keep a couple of known-
   good code/0 fixtures in the playground for one-click demos.

Acceptance: `pnpm dev` serves the playground; pasting the bundled orders-
dashboard fixture yields a working interactive surface driven by real granted
actions; the `write` action triggers the approval flow; a fixture with a
thrown guest error shows in the event log, not a silent dead surface; a
Playwright smoke test drives paste → mount → action call → result. Port
`orders-admin-proof.test.ts` to code/0 as the runtime-level regression proof
before M5 deletes the old one.

### M5 — Demolition

Delete: `src/dialect/**`, `src/dom/sandbox-runtime*`, `src/dom/result-state*`,
`src/dom/result-routing*`, `src/dom/sandbox-asset.generated.ts`,
`src/dom/sandbox-entry.ts`, `src/dom/sandbox-bridge.ts` (genui/0 version),
`scripts/build-sandbox-asset.mjs`, the `sandbox:build` script step, the
`parse5` dependency, and all genui/0 tests. Remove the `genuiDialect`
(`"genui/0"`) constant from `@genui/protocol` — `"code/0"` is the only
shipped dialect id after this milestone. Simplify `surface-runtime.ts`: drop
the legacy-record normalization (`MaybeLegacySurfaceRecord`) — there are no
legacy deployments. Refresh `README.md` if any of it went stale.

Acceptance: `git grep -iE "genui0|genui/0|data-genui"` matches only
ROADMAP.md; full `pnpm check` green in every package; the playground still
passes M4 acceptance.

### M6 — Red-team suite

Named tests, one per invariant (see §6). Add the missing enforcement they
reveal, keeping it minimal:

- forged postMessage (wrong channel / surfaceId / non-iframe source) → ignored
- ungranted action call → `not_granted`, never executes
- action turned `block` after grant creation → blocked at execute
- invalid input → `invalid_input`, `execute` never runs, approval never asked
- approval denial → `approval_denied`, no execution
- replayed result message / duplicate `callId` → ignored by guest bridge
- self-navigation → surface killed + violation event (real browser test)
- call flooding → per-surface in-flight cap (pick 8) → excess rejected with
  `rate_limited` (new `ActionErrorCode`)
- oversized call input (> 64 KiB serialized) → rejected before validation

### M7 — Stretch (only if M1–M6 are done and green)

In priority order: (1) `callId` idempotency for `write`/`dangerous` actions in
the kernel (dedupe window via the store; requires a store method — design it
minimally, record the decision in §10). (2) Guest state snapshot/restore:
`genui.snapshot(fn)` registration + host `snapshot()`/restore across
`replace()`, mirroring the old snapshot protocol. (3) Grant TTL/revocation:
`revoke(surfaceId)` store support + expiry check in `execute()`.

## 6. Testing philosophy

- **Every security invariant is a named test.** The invariant list in M6 is
  the floor, not the ceiling. If you find yourself relying on an unstated
  invariant, write the test that states it.
- **Test the real boundary.** Kernel tests call the real `execute()` with real
  schemas. DOM logic units run on happy-dom. At least one Playwright test per
  renderer exercises the genuine iframe + CSP + postMessage stack — the
  sandbox is the product; never mock it in the test that certifies it.
- **Errors are behavior.** Every `ActionErrorCode` has a test producing it as
  a returned value (never a throw across the boundary).
- **TDD for kernel changes.** Red test first for M1/M2/M6 items.
- **Determinism.** No network, no timers without control, no flaky waits.
- **Don't test prose.** Assert that `instructions()` contains action names and
  schemas; don't snapshot the full text.
- Runner: `nub --test` (see package.json scripts). `pnpm check` per package =
  lint + format + typecheck + tests. That is the gate for every commit.

## 7. Commit pattern

- One logical change per commit. A milestone is typically 2–6 commits, never
  one giant one at dawn.
- Subject: imperative, ≤ 60 chars, matching existing history style
  (`Fix approval ordering in action execution`, `Add code/0 guest bootstrap`).
  No `feat:`/`fix:` prefixes.
- Body: 1–3 sentences of *why*, plus the milestone tag, e.g. `Roadmap: M1.1`.
- `pnpm check` must be green in every touched package before committing.
  Never commit red; never commit commented-out code.
- Work directly on `main`. No branches, no force-push, no history rewrites.
- Do not push unless a remote is configured and pushing was requested.

## 8. Hard scope guards — do NOT

- Do not add expression languages, template directives, data-attribute DSLs,
  or sanitizer-enforced dialects. If a guest needs logic, it writes JavaScript.
- Do not add a build/compile step for guest code (no TSX, no bundler, no
  dependency resolution). Guests are buildless HTML + ESM.
- Do not add a React renderer, Worker/remote-view renderer, or component
  catalog. Those are future proofs, gated on the kernel being finished.
- Do not add runtime dependencies to `@genui/protocol` (ever) or to the kernel
  (without a §10 entry explaining why).
- Do not build multi-tenant auth, rate-limit infrastructure beyond the M6 cap,
  or persistence backends beyond the in-memory store.
- Do not grow the playground beyond what M4 specifies — no chat UI, no
  sessions, no streaming, no CSS frameworks, no Datastar. It is a test rig,
  not a product.
- Do not add a live LLM integration anywhere; there are no model credentials
  in this environment. The paste-mode + copy-instructions loop is the model
  interface.
- Do not reintroduce anything from `docs/genui` or `examples/chat` git
  history.

## 9. When you are unsure

1. Re-read §2. Pick the option that satisfies more of it.
2. Prefer the smaller diff, the fewer concepts, the standard platform feature.
3. If two options remain, pick either, ship it, and append the decision to
   §10 with one sentence of rationale. Do not stall, and do not expand scope
   to dodge the decision.

## 10. Decision log

Append entries as `- YYYY-MM-DD <decision> — <rationale>`. Do not edit or
delete earlier entries.

- 2026-07-10 Adopted code/0 (buildless sandboxed JS + capability bridge) as
  the sole renderer; genui/0 scheduled for deletion — two independent design
  reviews converged: the DSL fought model priors and added no security beyond
  the iframe boundary it already depends on.
- 2026-07-10 Catalog/React/remote-view renderers deferred until after M6 —
  prove the kernel with the cheapest renderer first.
- 2026-07-10 Deleted `examples/chat` (commit history has it) and replaced the
  M4 migration milestone with a minimal credential-free playground host —
  the chat app was heavy foreign code, carried genui/0 residue, and required
  model credentials the autonomous agent does not have.
- 2026-07-10 Clarified the two approval points (client `confirm` = trusted UX
  preview on raw input; kernel `approve` = authoritative gate on validated
  input) — an earlier draft implied the browser broker had the parsed input,
  which is impossible since validation is server-side.
