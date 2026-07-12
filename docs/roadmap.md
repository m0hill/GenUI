# GenUI roadmap

Use this document to decide what belongs in GenUI and what should remain in a
host adapter or application. Move completed API guidance into the relevant
guide and remove the completed roadmap item.

## Product boundary

GenUI owns portable generated-interface security and lifecycle behavior:

- authoritative surface grants;
- action and subscription policy enforcement;
- sandbox execution and the trusted browser bridge;
- surface mounting, replacement, teardown, and state capture;
- transport-independent protocols and codecs;
- host context, styling, and optional host capabilities;
- conformance tests for portable adapters.

Host adapters own integration with HTTP, Datastar, React, or another rendering
framework:

- action, approval, and subscription transport;
- mounting surfaces inserted by the framework;
- checkpoint timing around navigation or form submission;
- trusted consent UI;
- durable store selection and application identity.

Applications own product data and model behavior:

- databases and domain repositories;
- authentication and authorization identities;
- model tools that read application state;
- conversation persistence;
- product-specific action implementations;
- decisions about which UI state should reach a future model turn.

Do not use conversation history or guest snapshots as authoritative application
state. Do not reconstruct authority from generated HTML or a browser-provided
grant.

## Existing foundation

Preserve these existing capabilities while completing the roadmap:

- `action()` definitions with effects, policy, schemas, approval intent,
  confidentiality, validation, and idempotency;
- `subscription()` definitions with reauthorization, event validation, bounded
  delivery, cancellation, and lifecycle auditing;
- `SurfaceStore` with a conformance suite for authority, revocation, and
  effectful-call coordination;
- opaque-origin `code/0` sandboxing with a network-denying CSP and liveness
  enforcement;
- `mount()`, `replace()`, `snapshot()`, `teardown()`, and `dispose()`;
- host styling, host context, `sendMessage`, `openLink`, and
  `updateModelContext`;
- trusted approval callbacks using kernel-rendered intent;
- trusted action, subscription, violation, and error diagnostics.

Read [actions.md](actions.md), [subscriptions.md](subscriptions.md),
[code0.md](code0.md), [hosting.md](hosting.md), and [stores.md](stores.md) before
changing one of these contracts.

## Required next work

### Stream generated surfaces as revisions

Add progressive surface generation to GenUI instead of implementing a draft
interface independently in each example.

Define `SurfaceDraft` as a transport-independent preview value with:

- `generationId` to correlate one generation attempt;
- a monotonically increasing `revision`;
- `dialect`;
- complete preview `content`.

Do not include a grant, actions, subscriptions, host capabilities, snapshots,
or application authority in `SurfaceDraft`.

Expose strict codecs from `genui/protocol`. Reject unknown fields, unsupported
dialects, reused revisions, mismatched generation IDs, and oversized content.

Stream atomic draft revisions, not arbitrary byte fragments or DOM mutations.
Each accepted revision must be a complete renderable fragment. A provider
adapter may coalesce token or tool-argument deltas before publishing a
revision.

Provide a browser API with this shape:

```ts
import { mountDraft } from "genui/dom"

const draft = mountDraft(root, firstRevision, { hostContext })
draft.update(nextRevision)

const mounted = draft.commit(surface, {
  transport,
  subscriptionTransport,
  capabilities,
})

draft.fail()
draft.cancel()
```

`update()` accepts only the next valid revision for the handle's generation.
`commit()` is terminal, removes the preview, validates the final `Surface`, and
returns the ordinary authoritative `Mounted` handle. `fail()` is terminal,
keeps the last valid inert preview available for host-owned error UI, and emits
a trusted diagnostic. `cancel()` removes the preview and is idempotent and
terminal. Calls after a terminal transition are inert.

Render drafts as inert previews:

- disable script execution;
- do not install `window.genui`;
- prevent focus, input, form submission, navigation, and host capability use;
- apply trusted host style variables without exposing live host APIs;
- deny network and external resources by default;
- replace the whole isolated preview document for each revision.

Drafts have no user-owned state, so they have no snapshot API. Do not capture
or transfer state between draft revisions. Snapshot handling begins only after
the final authoritative surface is committed.

The draft lifecycle must define:

- a stable generation ID and monotonically increasing revision;
- `draft`, `committed`, `failed`, and `cancelled` behavior;
- cancellation when the user sends a new request or removes the host view;
- deterministic fallback to the last valid revision after malformed output;
- bounded content size, revision count, and generation duration;
- diagnostics for rejected, superseded, and failed revisions.

Expose the lifecycle through a framework-neutral API. Datastar and React hosts
should consume the same revision stream rather than implementing different
draft semantics.

### Provide a host surface controller

The low-level `mount()` API is correct, but every host should not rebuild the
same mount registry and lifecycle orchestration.

Add a framework-neutral controller that can:

- mount newly inserted surface elements;
- replace a mounted surface by revision;
- checkpoint one surface or all mounted surfaces;
- perform graceful teardown before removal;
- dispose mounts removed without teardown;
- update host context;
- expose trusted lifecycle events;
- serialize lifecycle work for the same surface without serializing unrelated
  surfaces.

Keep framework adapters thin:

- a Datastar adapter should bind explicit chat or navigation events instead of
  observing every generic Datastar fetch;
- a React adapter should expose a component or hook over the same controller;
- generated iframe content should remain framework-neutral and should not need
  Datastar or React.

### Standardize approval transport

The kernel owns approval policy and canonical intent. Hosts still need too much
custom code to transport provisional approval across an untrusted browser.

Provide transport helpers or an adapter that implements the protocol in
[hosting.md](hosting.md):

- issue unpredictable, short-lived server tokens only after
  `approval_required`;
- bind consent to subject, surface, call ID, action, and canonical validated
  input;
- consume consent once;
- reject preapproval, guest-chosen tokens, mismatches, replay, and expiry;
- support CSRF protection and shared pending state when replicas are used;
- return only the nested `ActionResult` to generated code;
- let the trusted host choose the consent UI.

Keep the protocol independent of `window.confirm`, Hono, Datastar, React, and a
specific database.

### Define snapshot resource limits

Snapshots are untrusted guest data. Standardize portable limits and helpers so
hosts do not invent incompatible policies.

Define:

- a default serialized byte limit;
- nesting and serialization behavior;
- capture and teardown deadlines;
- stable failure diagnostics;
- a host validation hook for product-specific snapshot schemas;
- compatibility rules for restoration across surface revisions.

Do not add implicit snapshot migrations. A host may explicitly transform a
known schema, or reject incompatible state and start the surface cleanly.

### Add draft and lifecycle conformance tests

Extend testing beyond individual store methods and browser broker units.

Provide reusable scenarios for:

- ordered, duplicate, skipped, and mismatched draft revisions;
- script, focus, form, navigation, network, and capability denial in drafts;
- atomic preview replacement and final commit;
- draft revision cancellation and supersession;
- snapshot capture, replacement, and restoration after commit;
- teardown during actions, subscriptions, and host capability calls;
- malformed, oversized, or accessor-hostile surface and snapshot data;
- revocation racing execution or event delivery.

Use real storage and browser boundaries where their behavior is under test.

## Hardening work

### Bound every resource

Define and enforce limits for:

- surface HTML and metadata;
- action inputs and outputs;
- active and completed calls;
- pending approvals;
- subscriptions, event size, and handler time;
- snapshot size and capture time;
- draft revisions and total generated bytes;
- iframe height, liveness, and teardown time.

Keep distributed rate limiting application-owned unless GenUI can define a
portable atomic contract.

### Make authority lifecycle explicit

Keep surface creation, expiry, replacement, revocation, and restoration
observable and fail closed.

Clarify whether replacement preserves a surface ID or creates new authority.
Revoke superseded grants promptly. Never let a browser snapshot extend grant
expiry or recreate a revoked surface.

### Improve trusted diagnostics

Add a development inspector over existing trusted events. It should display:

- the current surface and revision;
- projected actions, subscriptions, policy, subject, and expiry;
- action outcomes without sensitive input or output;
- approval state and expiry without tokens;
- subscription lifecycle and byte counts without event payloads;
- snapshot capture size and failure reason;
- sandbox violations, teardown, and liveness termination.

Keep secrets, raw sensitive data, approval tokens, and confidential results out
of logs and inspector history.

### Maintain protocol versioning

Version wire contracts and dialects explicitly. Reject unsupported versions
instead of guessing or maintaining accidental compatibility.

Document the compatibility window for hosts, servers, and persisted surface
records before publishing a stable package release.

## Deliberate extensions

Add these only when a concrete product needs them.

### Durable subscription cursors

Current subscriptions are at-most-once within one mounted connection. Add
reconnect, replay, or durable cursors only through an explicit subscription
contract. Do not pretend a guest snapshot restores a live stream.

### Remote revocation notifications

A shared store currently prevents another event after revocation but may leave
a quiet remote stream connected. Add store notifications only as hints followed
by authoritative reads.

### Additional host capabilities

Consider clipboard, file selection, artifact download, or host navigation only
as narrow, feature-detected, host-mediated capabilities. Define validation,
consent, confidentiality, cancellation, and audit behavior before exposing one
to generated code.

### Framework packages

Publish React, Datastar, or other framework packages only after the
framework-neutral controller is stable. Keep framework APIs as lifecycle
adapters rather than alternate GenUI runtimes.

## Application concerns that stay outside GenUI

Do not move these into the kernel:

- chat JSONL, message persistence, or conversation branching;
- database selection and `SurfaceStore` implementations;
- deployment-specific surface persistence policy;
- a user's saved preferences or other domain records;
- model-provider authentication;
- web search or application model tools;
- prompt selection and model cache strategy;
- application CSS beyond standardized host tokens;
- product analytics and business authorization rules.

Use server actions to mutate authoritative application data. Give the model
read tools that fetch that data when relevant. Use `updateModelContext` only for
temporary UI state needed by a future model turn. Use snapshots only to restore
the interface.

Persistent hosts must provide their own conformant `SurfaceStore`. Ephemeral
hosts may use `memoryStore()`. A host that restores serialized interface HTML
without restoring its authoritative surface record must present that interface
as stale or non-interactive instead of implying its actions still work.

GenUI must remain independent of SQLite, JSONL, Postgres, Redis, and every other
storage technology. Use `assertSurfaceStoreConformance()` to verify an
application adapter without prescribing its backend.

## Recommended order

1. Design and implement inert progressive surface revisions.
2. Add the framework-neutral host surface controller.
3. Package the approval transport protocol for reuse.
4. Standardize committed-surface snapshot limits and validation hooks.
5. Add draft streaming and lifecycle conformance scenarios.
6. Build the trusted development inspector.
7. Evaluate optional subscription and host-capability extensions from real use
   cases.
