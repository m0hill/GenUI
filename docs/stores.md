# Distributed surface stores

Use `memoryStore()` only in one process. Its surfaces, completed calls, and
in-flight joins are not shared with another `Genui` instance or replica.

Use a shared `SurfaceStore` before running more than one server instance. The
store must preserve complete `SurfaceRecord` values and implement
`runIdempotent()` as one atomic coordination protocol.

## Verify an adapter

Run the package contract against two adapter instances connected to the same
isolated backend:

```ts
import { test } from "node:test"
import { assertSurfaceStoreConformance } from "genui/testing"
import { createPostgresSurfaceStore } from "./postgres-surface-store.js"

void test("Postgres SurfaceStore contract", async () => {
  await assertSurfaceStoreConformance(() =>
    createPostgresSurfaceStore({ pool, namespace: testNamespace }),
  )
})
```

The check covers cross-instance record visibility, concurrent joining,
fingerprint conflicts, completed-result replay, provisional
`approval_required` cleanup, and revocation. Run it against the real database,
not an in-memory fake.

## Required idempotency states

Store each `(surfaceId, callId)` in one of two states:

- `pending` contains the fingerprint, an owner token, and a short lease.
- `completed` contains the fingerprint, serialized result, and expiry for the
  requested idempotency window.

Apply these rules atomically:

1. The first matching request claims `pending` with an unpredictable owner
   token. Run `operation()` only after the claim commits.
2. A different fingerprint returns `conflict` without running the operation.
3. A matching `completed` record returns its stored result.
4. A matching `pending` record waits for completion or lease expiry, then reads
   state again. Notifications are hints; always re-read authoritative state.
5. The owner runs `operation()` outside the database transaction.
6. A terminal result replaces `pending` with `completed` only when the owner
   token still matches.
7. An `approval_required` result deletes `pending`; it must never become a
   completed replay.
8. A thrown operation deletes its owned `pending` record before propagating the
   failure.
9. `revoke(surfaceId)` removes the surface and every idempotency record for that
   surface atomically.

## Postgres reference layout

Use a foreign key so revocation removes call state with the surface:

```sql
CREATE TABLE genui_surfaces (
  id text PRIMARY KEY,
  record jsonb NOT NULL
);

CREATE TABLE genui_calls (
  surface_id text NOT NULL REFERENCES genui_surfaces(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'completed')),
  owner_token uuid,
  result jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (surface_id, call_id)
);
```

Claim with `INSERT ... ON CONFLICT DO NOTHING` inside a short transaction. If
the insert loses, lock or read the existing row and apply the state rules
above. Commit before calling application code. Finalize with an update or
delete conditioned on the owner token. Use `LISTEN`/`NOTIFY` only to reduce
polling; reconnects and missed notifications must fall back to reading the
row.

## Redis reference layout

Use one hash per call with fields for fingerprint, state, owner token, result,
and expiry. Put the surface ID in a Redis Cluster hash tag, for example
`genui:{surfaceId}:call:callId`, and maintain a set of call keys for revocation.

Implement claim, conflict detection, completion, provisional deletion, and
owner-token checks as Lua scripts. A sequence of separate `GET`, `SET`, and
`DEL` commands is not atomic. Pub/Sub may wake waiters, but waiters must re-read
the hash because messages can be lost.

## Crash limits

A pending lease allows recovery when an owner dies, but lease takeover can
overlap a slow original operation. A generic `SurfaceStore` cannot guarantee
exactly-once external side effects across a process crash.

Use `(surfaceId, callId)` as an idempotency key in the downstream system, or
commit the domain mutation and idempotency result in one database transaction.
Use an outbox when the effect crosses a non-transactional boundary.

The kernel's eight-call in-flight cap is also process-local. Add a shared rate
limiter when a limit must apply across replicas.
