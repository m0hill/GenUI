# GenUI Roadmap — Phase 2

Written 2026-07-10, revised 2026-07-11 after phase 1 (M1–M7) shipped. This
file is the **single source of truth** for what to build, in what order, how
to test it, and how to commit it.

If anything here conflicts with code comments, old commit messages, or your
own ideas about what would be cool: **this file wins.** For current API truth
read the guides in `docs/` (§7); this file is the plan, not the reference.

---

## 1. Goal

Build the safe substrate on which LLMs generate real, interactive web UI.

The promise to host-app developers:

> Define your app's actions once — name, description, schema, effect, policy,
> intent — and any model-generated surface can use them, under isolation and
> authority rules the renderer cannot weaken.

The model authors an ordinary tiny web app (HTML + vanilla JS). It runs in a
locked sandbox (opaque-origin iframe, no network, no storage). The **only**
door out is `genui.call(name, input)` — a typed, granted, policy-checked,
human-approvable action pipeline enforced host/server-side.

Phase 2 turns the working framework into a trustworthy one: authority bound
to identities, honest containment limits, CI, publishable artifacts, and an
evaluation rig for real model output.

What this project is **not**:

- Not a JSON component system.
- Not a custom template/expression language (genui/0 was deleted in phase 1;
  do not resurrect or imitate it).
- Not a React framework, a build pipeline for guests, or a design system.

## 2. Constitution

Every design decision is checked against these. If a change violates one,
don't make the change.

1. **Authority lives in the kernel, never in the renderer.** Every
   outside-world effect flows through a granted, schema-validated,
   policy-checked action enforced on the trusted side. If a design is only
   safe when the renderer behaves, the design is wrong.
2. **Isolation is a boundary, not a filter.** Safety comes from where
   generated code runs (opaque origin, no network, capability-only IO), not
   from constraining what it says. Sanitization is never a load-bearing
   security control.
3. **No ambient authority.** A surface can touch exactly what it was handed:
   per-surface, inspectable grants. Deny by default. A requested name is not
   a grant.
4. **Humans approve effects, not pixels.** Consent UI (intent template,
   effect class, input echo) is rendered by the trusted host from the grant
   and the **canonical, validated** input — never by the generated surface.
5. **Meet the model where it was trained.** HTML, plain JavaScript, and JSON
   Schema. No bespoke DSLs. Every line of custom instruction text is a tax.
6. **Define contracts once, derive everything else.** Validation,
   model-facing schemas, TypeScript types, approval previews, and codecs all
   come from the same action definition.
7. **Errors round-trip to the model.** Guest runtime errors, denied calls,
   and invalid inputs must reach the generating model in legible form. A
   silently dead button is a design defect.
8. **Small frozen center, replaceable edges.** Protocol and kernel stay tiny.
   Renderers, hosts, stores, transports are replaceable leaves.
9. **Complexity must pay rent.** A package, abstraction, or feature must
   measurably improve safe expressiveness or remove real user burden.

## 3. State of the repo

Phase 1 (M1–M7) is complete: kernel correctness fixes, JSON-Schema
projection, protocol codecs, the code/0 renderer (bootstrap bridge, mount,
navigation tripwire), the credential-free playground, genui/0 demolition,
the red-team suite, idempotency, snapshots, and grant expiry/revocation.
81 tests across three packages; `git log` and §11 hold the details.

Layout:

```
@genui/protocol          wire types, JSON-Schema projection, codecs
@genui/genui
  src/                   kernel: actions, grants, policy, execute, store
  src/dom/               host: mount(), broker, tripwire, approval hooks
  src/code/              code/0 guest: bootstrap script, instructions()
examples/playground      credential-free proving-ground host
docs/                    actions.md, code0.md, hosting.md + writing guide
```

Known gaps this phase addresses (verified against source):

- `genui.actions` is empty while guest startup scripts run: the grant
  arrives via a postMessage that `mount()` sends on iframe `load`, but
  module scripts execute before `load` fires (`src/code/bootstrap.ts`,
  `src/dom/index.ts`). The API misleads; the grant is known at document
  build time and should be embedded.
- Approval is client-asserted: the playground forwards `approved: true` and
  the server's `approve` hook echoes it (`examples/playground/src/app.ts`).
  Acceptable for a demo; it means no server-side identity actually gates
  approval, and grants are not bound to any principal.
- No audit trail: `execute()` outcomes are not recorded anywhere.
- No CPU/memory containment: a `while(true)` guest hangs its iframe
  undetected. The navigation tripwire also only *detects* egress after the
  request has left; that stays detect-and-kill by design — confidentiality
  tiers are the mitigation for sensitive data.
- The guest bootstrap accepts messages from any source holding a
  contentWindow reference; it should verify `event.source === window.parent`
  (the host side already verifies its direction).
- Idempotency fingerprints hash raw JSON text, so key order changes read as
  conflicting input (`src/registry.ts`).
- No CI. Nothing runs `pnpm check` except agents on their honor.
- Packages export raw `.ts` sources (`"types": "./src/index.ts"`); nothing
  is installable outside this workspace.

## 4. Architecture rules for this phase

- The package layout does not change. No new packages (§10 to argue
  otherwise, §11 to record it).
- Protocol changes in this phase: `SurfaceRecord`/`SurfaceInput` gain an
  optional `subject`, and codecs follow. Nothing else on the wire changes
  without a §11 entry.
- The guest bridge API may only *gain* the embedded grant; its surface
  (`surfaceId`, `actions`, `call`, `snapshot`) is otherwise frozen.
- Every new kernel behavior ships with its invariant test (§6) in the same
  commit.

## 5. Milestones

Work them **in order**. Each milestone ends with all checks green and one or
more commits. The tree must never be left broken between milestones.

### M8 — Close the phase-1 gaps

1. Embed the grant in the bootstrap config (like `restore` already is) so
   `genui.actions` is correct before any guest script runs. Every
   `replace()` writes a fresh document, so the load-time grant postMessage
   becomes redundant — remove it and its message type.
2. Guest bootstrap ignores inbound messages where
   `event.source !== window.parent`.
3. Canonicalize idempotency fingerprints: stable key ordering (recursive
   key sort) before hashing, so `{a,b}` and `{b,a}` are the same input.
4. Unresponsive-guest tripwire: the bootstrap posts a heartbeat every 1s;
   the host treats a gap over 6s as `{ type: "violation", reason:
   "unresponsive" }` and kills the surface like the navigation tripwire
   does. **Pinned guards against false positives:** evaluate the gap only
   while the host document is visible (`document.visibilityState`) AND the
   iframe intersects the viewport (IntersectionObserver) — browsers
   throttle timers in hidden pages and offscreen cross-origin iframes, and
   a throttled surface is not a hung one.

Acceptance: a guest that reads `genui.actions` in a top-level module script
sees the full grant (real-browser test); forged-source messages are ignored
(unit test); reordered-key retries dedupe instead of conflicting; a busy-loop
guest fixture gets killed with the violation event while a hidden-tab
simulation does not (real-browser test). `docs/code0.md` updated in the same
commits (§7).

### M9 — Identity, authoritative approval, audit

The kernel currently proves *which surface* is calling but not *for whom*.

1. Subject binding: `SurfaceInput` gains optional `subject` (opaque string,
   e.g. a user or session id) stored on the `SurfaceRecord` and echoed on
   `Grant`. `execute()` gains `ExecuteOptions.subject`; when the record has
   a subject and it does not match, return `not_granted` before any other
   work. Records without a subject keep today's behavior. Protocol codecs
   and `docs/actions.md`/`docs/hosting.md` updated.
2. Server-held approval: replace the playground's `approved: true` body flag
   with a server-side pending-approval store keyed by
   `(surfaceId, callId)`: an `ask` action's first execution returns a new
   `approval_required` error carrying the rendered intent
   (`renderActionIntent` over the **parsed** input, constitution §4); the
   client shows its dialog and re-sends the same call with the playground
   session's approval registered via a `POST /genui/approve` endpoint that
   records consent server-side before the retry. The kernel's `approve`
   hook reads that store. The kernel itself stays transport-agnostic —
   `approval_required` is the only kernel change; the pending store is
   playground/host code and the pattern is documented in `docs/hosting.md`.
3. Audit hook: `GenuiOptions.onCall?(entry)` invoked after every `execute()`
   with `{ surfaceId, callId, subject?, action, effect, outcome, at }`
   where outcome is the `ActionErrorCode` or `"ok"`. Fire-and-forget:
   kernel never awaits it and a throwing hook cannot affect the result.
   The playground logs entries to its event panel.

Acceptance: invariant tests — a call with the wrong subject never reaches
validation; an unapproved `ask` call returns `approval_required` and executes
exactly once after approval (idempotency still holds across the retry); audit
entries fire for ok, denied, and invalid calls; a throwing audit hook changes
nothing. Playwright test drives the full playground approval round trip.

### M10 — CI and installable packages

1. GitHub Actions workflow (`.github/workflows/check.yml`): pnpm via
   corepack, install, `pnpm check`, with Playwright browsers
   (`playwright install --with-deps chromium`) cached. Runs on push and
   pull request. It must pass on the first try — verify locally with the
   same commands before committing.
2. Build outputs: `tsc` emit for `@genui/protocol` and `@genui/genui` to
   `dist/` (js + d.ts), proper `exports` maps with `types`/`import`
   conditions, `files` fields, and a repo-root `pnpm build`. Keep
   `private: true` — **publishing itself is user-gated** (npm scope and
   names are the owner's call).
3. Prove installability without publishing: `pnpm pack` both packages and a
   test that installs the tarballs into a temp project and imports the
   kernel and codecs from the built output.

Acceptance: CI green on the repo; `pnpm build && pnpm pack` produce tarballs
whose smoke test passes; `pnpm check` still green (dist/ excluded from lint
and format).

### M11 — Generation evaluation rig

The framework's real test is model-authored surfaces, and this environment
has no model credentials. Build the rig so the owner's manual loop scales:

1. `examples/playground/fixtures/incoming/` — the owner drops raw model
   outputs here as `.html` files (each paired with an optional `.json` of
   expected action calls).
2. `pnpm eval` (playground script): starts the server, drives headless
   Playwright over every incoming fixture, and reports per fixture: mounted
   without `guest_error`, no violations, granted calls succeeded, ungranted
   calls were denied, and any expected-calls file matched. Output is a
   Markdown table to stdout plus a nonzero exit if any fixture fails.
3. Failures must be legible enough to paste back to a model for repair
   (constitution §7): include the event log and the failing assertion per
   fixture.
4. Document the workflow in `docs/hosting.md` (copy instructions → generate
   with any LLM → drop file → `pnpm eval`).

Acceptance: rig passes against the bundled known-good fixtures, fails
loudly against a bundled known-bad fixture (guest error) and a
known-malicious one (ungranted call + navigation attempt), and the README
mentions `pnpm eval`.

### Stop condition

When M8–M11 are done and green: **stop.** Do not invent further milestones.
End with a summary — what shipped per milestone, test counts, §11 entries,
and the exact commands to see CI status, run the playground, and run the
eval rig. Explicitly out of scope until the owner decides, informed by eval
results: publishing to npm, a catalog/React/remote renderer, multi-tenant
policy, persistence backends, and any real-LLM integration.

## 6. Testing philosophy

- **Every security invariant is a named test.** If you rely on an unstated
  invariant, write the test that states it. Phase 1's red-team suite is the
  floor; M8/M9 add: embedded-grant timing, forged-source rejection,
  unresponsive-guest kill (with the visibility guard), subject mismatch,
  approval round trip, audit isolation.
- **Test the real boundary.** Kernel tests call the real `execute()` with
  real schemas. DOM logic units run on happy-dom. Playwright certifies the
  genuine iframe + CSP + postMessage stack — never mock the sandbox in the
  test that certifies it.
- **Errors are behavior.** Every `ActionErrorCode` (including the new
  `approval_required`) has a test producing it as a returned value.
- **TDD for kernel changes.** Red test first for M8.3, M9, and any protocol
  change.
- **Determinism.** No network, no uncontrolled timers, no flaky waits. The
  heartbeat tests use fake or controllable clocks wherever the real browser
  isn't required.
- Runner: `nub --test`; `pnpm check` per package = lint + format +
  typecheck + tests. That is the gate for every commit.

## 7. Documentation

`docs/documentation.md` is the writing guide. Read it before creating or
editing any Markdown, including this file. `docs/README.md` is the index;
every guide must be listed there.

The guides (`actions.md`, `code0.md`, `hosting.md`) hold current API truth.
Any commit that changes behavior they describe updates them **in the same
commit**: M8 touches `code0.md` (embedded grant, heartbeat), M9 touches
`actions.md` and `hosting.md` (subject, `approval_required`, audit, the
approval pattern), M10 touches `hosting.md`/README (install, build), M11
touches `hosting.md` (eval workflow). Doc-only fixes may land as their own
commits at any time.

## 8. Commit pattern

- One logical change per commit. A milestone is typically 2–6 commits,
  never one giant one at dawn.
- Subject: imperative, ≤ 60 chars, matching existing history style
  (`Embed the grant in the guest bootstrap`). No `feat:`/`fix:` prefixes.
- Body: 1–3 sentences of *why*, plus the milestone tag, e.g. `Roadmap: M8.1`.
- `pnpm check` must be green in every touched package before committing.
  Never commit red; never commit commented-out code.
- Work directly on `main`. No branches, no force-push, no history rewrites.
- Do not push unless a remote is configured and pushing was requested.

## 9. Hard scope guards — do NOT

- Do not add expression languages, template directives, data-attribute
  DSLs, or sanitizer-enforced dialects. Guests write JavaScript.
- Do not add a build/compile step for guest code. Guests stay buildless
  HTML + ESM. (M10's build step is for the *packages*, not guests.)
- Do not add a React renderer, Worker/remote-view renderer, or component
  catalog. Deferred until eval evidence says otherwise.
- Do not publish to npm or remove `private: true` — user-gated.
- Do not add a live LLM integration anywhere; there are no model
  credentials in this environment. The eval rig consumes files.
- Do not add runtime dependencies to `@genui/protocol` (ever) or to the
  kernel (without a §11 entry explaining why).
- Do not build multi-tenant auth or persistence backends; `subject` is an
  opaque string the host supplies, nothing more.
- Do not grow the playground beyond the milestones — it is a test rig, not
  a product.
- Do not reintroduce anything from `docs/genui` or `examples/chat` git
  history.

## 10. When you are unsure

1. Re-read §2. Pick the option that satisfies more of it.
2. Prefer the smaller diff, the fewer concepts, the standard platform
   feature.
3. If two options remain, pick either, ship it, and append the decision to
   §11 with one sentence of rationale. Do not stall, and do not expand
   scope to dodge the decision.

## 11. Decision log

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
- 2026-07-10 Kernel `approve` receives `(action, canonicalInput)` while call
  metadata stays in the host's surrounding request scope — this keeps the
  authoritative hook focused on the exact value being approved.
- 2026-07-10 Sensitive actions remain available to trusted registry inspection
  but surface projection drops them — confidentiality restricts renderer access
  without erasing definitions needed by future execution profiles.
- 2026-07-10 Oversized or non-JSON action input returns `invalid_input` — the
  payload is malformed for the JSON capability boundary, while `rate_limited`
  remains specific to concurrent-call pressure.
- 2026-07-10 Effectful call idempotency uses atomic
  `SurfaceStore.runIdempotent` with a five-minute post-completion window and an
  action-plus-raw-JSON fingerprint — concurrent retries share one result while
  conflicting call ID reuse returns `invalid_input`.
- 2026-07-10 `genui.snapshot(fn)` uses one dual-purpose provider that receives
  restored JSON at registration and returns current state on host request;
  same-ID replacement restores automatically while cross-ID transfer requires
  an explicit host snapshot — this keeps the guest API small and prevents
  accidental state leakage between authority records.
- 2026-07-10 Surface `ttlMs` becomes one absolute `grant.expiresAt` that
  reprojection never extends; expiry and explicit `revoke(surfaceId)` remove
  both the authority record and its idempotency entries — revocation stays a
  small store primitive with predictable retry behavior.
- 2026-07-11 Phase 2 scoped to hardening (M8), identity/approval/audit (M9),
  CI/installability (M10), and an eval rig (M11); catalog renderer and npm
  publishing stay deferred — real-model eval evidence should drive both, and
  publishing names are the owner's call.
- 2026-07-11 Navigation containment stays detect-and-kill; sensitive data is
  protected by confidentiality tiers, not by trying to prevent iframe
  self-navigation — CSP cannot govern navigation and pretending otherwise
  would misstate the threat model.
- 2026-07-10 Heartbeat monitoring is best-effort liveness, not CPU isolation;
  a same-renderer synchronous loop can starve the host monitor, so the browser
  invariant simulates missing heartbeats while the host remains schedulable —
  guaranteed CPU termination requires an out-of-process renderer deferred by
  §9.
