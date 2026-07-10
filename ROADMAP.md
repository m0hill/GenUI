# GenUI Roadmap — Phase 3

Written 2026-07-10, revised 2026-07-12 after phase 2 (M8–M11) shipped. This
file is the **single source of truth** for what to build, in what order, how
to test it, and how to commit it.

If anything here conflicts with code comments, old commit messages, or your
own ideas about what would be cool: **this file wins.** For current API truth
read the guides in `docs/` (§7); this file is the plan, not the reference.

---

## 1. Goal

Phases 1–2 built a working, hardened framework fast. Phase 3 makes the
codebase professional: **behavior-preserving cleanup only**. No new
features, no new capabilities, no wire changes. The end state is a codebase
that reads like one careful engineer wrote it — every helper earns its
keep, every export has an external caller, every comment answers *why*,
every type flows from its source of truth.

The functional goal is unchanged and frozen this phase:

> Define your app's actions once — name, description, schema, effect,
> policy, intent — and any model-generated surface can use them, under
> isolation and authority rules the renderer cannot weaken.

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

Phases 1–3 complete: code/0 renderer, playground, red-team suite,
idempotency, expiry/revocation, subject binding, authoritative approval,
audit hook, CI workflow, installable builds, eval rig. 106 tests green
across two packages. `git log` and §11 hold the details.

Verified quality findings that motivated this phase (all confirmed against
source on 2026-07-12):

- `isRecord` is defined **six times**: the protocol (now
  `packages/runtime/src/protocol/index.ts`),
  `packages/runtime/src/record.ts` (a two-line file exporting only this),
  and four copies across `examples/playground/src/` (`app.ts`,
  `eval-runner.ts`, `actions.ts`, `execute-envelope.ts`).
- `examples/playground/src/eval-runner.ts` defines five `is*Event`
  predicates (`isCallEvent`, `isResultEvent`, …) that restate the runtime's
  exported `SurfaceEvent` union shape by hand.
- `packages/runtime/src/surface-runtime.ts` carries ~23
  `Object.freeze`/`copyX` sites — defensive-copy ceremony guarding readonly
  types that already promise immutability at compile time.
- `packages/runtime/src` exports ~53 distinct symbols; not all have
  callers outside their own file or package.
- `packages/runtime/src/types.ts` both re-exports protocol symbols (a
  second import path for the same types) and hand-writes the Standard
  Schema interface shapes.
- Comment hygiene is decent (one internal `//` comment repo-wide) but many
  JSDoc blocks narrate the signature instead of adding information.

## 4. The quality bar

These rules are the phase's specification. Apply them file by file. When
they conflict with each other, correctness and debuggability win, then
existing conventions, then smaller diffs.

### Boundaries parse once; the interior trusts types

- `unknown` may exist only at real boundaries: wire messages, JSON bodies,
  postMessage data, fixture files, anything that crossed serialization.
  Parse it there, once, into a typed value — then never re-check it.
- A structural check inside code that already holds a typed value is
  defensive noise. Delete it.
- Prefer `parseX(input): X | undefined` (or the codec style already in
  `@genui/genui/protocol`) over exported `isX` predicates for untrusted
  input.
  Keep `isX` only as a true predicate over already-typed values (e.g.
  narrowing a union member), and prefer discriminant checks
  (`event.type === "call"`) over hand-written shape predicates when the
  input is already a typed union.
- Keep `isRecord` private to genuine serialization boundaries. The import-free
  protocol and sandbox message codec each own one; exporting a generic
  predicate or coupling the protocol back to runtime would be worse than the
  two-line duplication. The playground should consume `@genui/genui/protocol`
  codecs instead of hand-rolling wire checks; its own boundary parsers live in
  one place, not per file.

### Helpers and abstractions must pay rent

- Deletion test for every helper, type, and module: if inlining it makes
  the caller clearer, inline it. A helper earns its keep by hiding real
  complexity or being needed in several places — not by giving one `if` a
  name.
- No single-helper grab-bag files (`record.ts` is the standing example —
  fold it into its only consumers or a real home).
- Single-use trivial wrappers, pass-through functions, and one-line
  indirections get inlined.
- Do not "balance" this by extracting new helpers elsewhere. The default
  motion this phase is *removal*.

### Types flow from the source of truth

- Derive instead of restating: `Pick`, `Omit`, `Parameters`, `ReturnType`,
  `typeof`, indexed access (`CallAuditEntry["effect"]` style — already done
  well in `execute-envelope.ts`; make it the norm).
- A hand-written interface that duplicates an existing exported type is a
  bug. Point at the owner.
- One import path per type: consumers import protocol types from
  `@genui/genui/protocol`, runtime types from the file that owns them. Re-export
  shims (`runtime/src/types.ts` re-exporting protocol) are removed unless
  removing them breaks the public package API — in that case keep the
  package entrypoint as the single deliberate public surface and strip the
  rest.

### Exports are a promise

- Export only what has a caller outside the file. Unexport the rest.
- The package entrypoints (`index.ts`) define the public API: everything
  reachable there must be intentional, documented, and used by the
  playground, another package, or the docs. Audit each export; remove what
  nothing uses. Wire-visible names and the guest bridge API are frozen —
  changing those is out of scope.
- Same-package tests may import internal modules directly; that does not
  justify an export from the package entrypoint.

### Comments answer why, never what

- Internal `//` comments exist only for: invariants the code cannot show,
  non-obvious trade-offs, `SAFETY:` justifications for casts, and warnings
  about traps (e.g. the timer-throttling guard rationale). Anything
  narrating what the next lines do is deleted.
- JSDoc stays on exported API where it adds information beyond the name and
  signature — behavior notes, units, failure modes, ordering guarantees.
  JSDoc that restates the identifier ("Returns whether the name is valid")
  is deleted or rewritten to say something real.
- Do not add comments to satisfy a quota. Fewer, better.

### Ceremony is scrutinized

- The freeze/copy layer in `surface-runtime.ts`: decide once whether
  runtime immutability is a real invariant (records shared with host code
  that might mutate) or compile-time `readonly` suffices. Keep deep-freeze
  where a genuine cross-boundary aliasing risk exists (record it as a
  `SAFETY:`-style why-comment), delete the rest. One decision, applied
  uniformly, logged in §11.
- Repeated inline validation lambdas in tests get named once and reused;
  otherwise tests meet the same bar as source.

### Organization

- Precise file names over vague ones; a file owns one concept. Split
  `runtime/src/protocol/index.ts` only if the pieces (wire types / codecs /
  intent rendering) genuinely change for different reasons — the entrypoint
  must still re-export the same public API. Do not create barrels elsewhere.
- Consistent ordering within files: public API first or last, but the same
  choice everywhere in a package.
- No behavior may move between packages.

## 5. Milestones

Work them **in order**, one package at a time so review stays tractable.
Every milestone is behavior-preserving: same tests pass (they may be
refactored to the same bar, never weakened), same wire shapes, same guest
bridge, same playground behavior, `pnpm check` and `pnpm eval` green at
every commit.

### M12 — Protocol pass (`packages/runtime/src/protocol`)

Apply §4 to the protocol directory: codec-style parsing as the single
pattern, predicate/export audit, JSDoc pruned to informative content,
decide the index-split question. The dependency-free test stays green.

Acceptance: every exported symbol has an external caller (runtime,
playground, or docs); no shape predicate is exported where a parse
function is the real need; JSDoc audit done.

### M13 — Runtime pass (`packages/runtime`)

The big one. Kernel (`src/`), host (`src/dom/`), guest (`src/code/`):

1. Remove `record.ts`; single boundary-parsing story per module.
2. Resolve the `types.ts` re-export shim and the hand-written Standard
   Schema shapes (derive or isolate them as the one deliberate vendored
   interface, with a why-comment).
3. The freeze/copy decision (§4, logged in §11).
4. Export audit against the package entrypoints (`.` and `./dom`) — the
   public API that remains is exactly what `docs/` describes; update docs
   in the same commit if the surface shrinks.
5. Comment/JSDoc pass over every file, including the embedded bootstrap
   script.

Acceptance: export count reflects real callers; no internal structural
checks on already-typed values; all 84+ runtime tests green (refactored
where they duplicated shape-checking helpers).

### M14 — Playground pass (`examples/playground`)

1. Replace the four local `isRecord` copies and hand-rolled wire-shape
   checks with `@genui/genui/protocol` codecs; the playground's own boundaries
   (fixture files, eval events crossing the Playwright serialization
   boundary) parse in one module, not per file.
2. Replace the five `is*Event` predicates with discriminant narrowing over
   the typed `SurfaceEvent` union at the one place events genuinely arrive
   as `unknown`.
3. Same comment, export, and helper audits.

Acceptance: `grep -rn "isRecord" examples/playground/src` shows at most one
definition, in a boundary-parsing module; eval rig behavior identical
(same fixtures pass and fail identically).

### M15 — Consistency sweep and final audit

1. Cross-package consistency: naming conventions (one style for parsers,
   events, options types), file ordering, error-message voice.
2. Re-run every §4 audit repo-wide and fix stragglers; verify `docs/`
   still matches the (possibly smaller) public API.
3. Produce the final report: exports removed, helpers deleted, lines
   removed vs. added (this phase should be strongly net-negative),
   remaining deliberate exceptions with their §11 entries.

Acceptance: full `pnpm check`, `pnpm eval`, packed-package smoke test
green; diff summary shows net deletion; a fresh reader can open any file
and find no comment answering "what", no unexplained ceremony, and no
export without a caller.

### Stop condition

When M12–M15 are done and green: **stop.** Do not invent further
milestones, do not add features, do not start phase 4. End with the M15
report plus test counts and any §11 entries. Explicitly out of scope:
publishing, new renderers, new capabilities, dependency changes, wire or
bridge changes, performance work.

## 6. Testing philosophy

- This phase adds few tests and deletes duplicated test helpers, but the
  bar is unchanged: **every security invariant stays named and green.**
  If a refactor makes an invariant test meaningless, the refactor is
  wrong, not the test.
- Behavior preservation is the acceptance criterion: identical error
  codes, identical event sequences, identical eval outcomes. When unsure
  whether an edit is behavior-preserving, write the pinning test first,
  then refactor.
- Tests meet the same quality bar as source (§4) but must never be
  weakened to pass it: no assertion removal, no scope narrowing.
- Runner: `nub --test`; `pnpm check` per package = lint + format +
  typecheck + tests. That is the gate for every commit.

## 7. Documentation

`docs/documentation.md` is the writing guide. Read it before creating or
editing any Markdown, including this file. `docs/README.md` is the index.

The guides hold current API truth. Any commit that removes or renames a
public export updates `actions.md`/`code0.md`/`hosting.md` in the same
commit. Expect M13 and M15 to touch them; content should only shrink or
sharpen this phase, never grow.

## 8. Commit pattern

- One logical change per commit — for this phase that usually means one
  file-or-module cleanup per commit, so each diff is reviewable as
  "obviously behavior-preserving".
- Subject: imperative, ≤ 60 chars (`Inline the record predicate`,
  `Prune narrating JSDoc from the kernel`). No `feat:`/`fix:` prefixes.
- Body: 1–3 sentences of *why*, plus the milestone tag, e.g.
  `Roadmap: M13.3`.
- `pnpm check` green in every touched package before committing. Never
  commit red; never commit commented-out code.
- Work directly on `main`. No branches, no force-push, no history rewrites.
- Do not push unless a remote is configured and pushing was requested.

## 9. Hard scope guards — do NOT

- Do not change behavior. No new features, capabilities, error codes,
  events, options, or config. If a cleanup reveals a genuine bug, write
  the failing test, fix it minimally, and log it in §11 — that is the only
  sanctioned behavior change.
- Do not touch wire shapes, the guest bridge API, the CSP, sandbox
  attributes, or anything a persisted `SurfaceRecord` depends on.
- Do not add or remove dependencies, packages, or build steps.
- Do not introduce new abstractions, base classes, generic utilities, or
  "shared" modules as part of cleaning up — the motion is removal.
- Do not reformat wholesale or churn files the audits found clean; diffs
  should trace to a §4 rule.
- Do not weaken, skip, or delete tests to make a cleanup land.
- Do not resurrect anything from `docs/genui` or `examples/chat` git
  history.

## 10. When you are unsure

1. Re-read §2 and §4. Pick the option that satisfies more of them.
2. Prefer the smaller diff, the fewer concepts, deletion over addition.
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
- 2026-07-10 Approval hooks are tri-state: `undefined` requests consent,
  `false` denies, and `true` approves; `approval_required` carries the
  canonical rendered intent in the existing error message and is never retained
  by idempotency stores — approved same-call retries can proceed without a new
  wire envelope.
- 2026-07-10 Browser confirmation reacts to an authoritative
  `approval_required` result and retries transport at most once; pending consent
  is one-shot server state bound to subject, action, and canonical input — raw
  browser booleans cannot authorize effects or changed retry input.
- 2026-07-10 Audit entries are emitted per top-level `execute()` attempt using
  the attempted subject and effect `unknown` for unregistered actions; hooks
  are fire-and-forget and isolated from results — denied/unknown attempts stay
  observable without inventing authority metadata or delaying execution.
- 2026-07-10 Negative eval fixtures live outside `incoming/` and evaluator
  tests assert that they fail; only known-good fixtures run by default —
  `pnpm eval` remains a green user gate while proving unsafe output fails
  loudly.
- 2026-07-12 Phase 3 scoped to behavior-preserving code quality (M12–M15):
  boundary-parse-once, helper/export/comment audits, freeze-ceremony
  decision, playground codec adoption — the codebase was built fast by
  agents across two phases and carries duplicated predicates, ceremony, and
  narration that a professional release should not.
- 2026-07-10 Trusted-host values rely on readonly types, with defensive copies
  only across caller and store aliases; `Object.freeze` remains only on the
  generated-code bridge where runtime tampering is hostile — shallow host-side
  freezes added ceremony without isolating nested values or strengthening
  authority.
- 2026-07-10 Folded the protocol into `@genui/genui` behind its `./protocol`
  entrypoint while retaining the no-import boundary test — the separate package
  had no independent consumer or release lifecycle, so npm packaging did not
  pay rent; `code/0` and its documentation remain the wire-version authority,
  and record predicates stay boundary-local rather than becoming public API.
