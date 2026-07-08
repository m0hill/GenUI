# Surface Runtime Model

This document defines the missing spine of the architecture: generated surfaces need identity.

Without surface identity, a capability grant is only a client-side convention. With surface identity, grants, manifests, approvals, persistence, result state, and restoration all attach to one stable object.

## Surface As A Runtime Object

A generated surface is not just HTML.

It should be a runtime object with:

- a stable surface ID;
- the generated HTML or a hash of it;
- the grant created for that surface;
- the visible manifest projected from that grant;
- the owner or user context;
- the originating chat, task, or agent turn;
- creation and update timestamps;
- optional state snapshot;
- optional approval and capability-call history.

The generated HTML is the body. The surface record is the identity.

## Grant vs Manifest

The grant is the authority set.

The manifest is the sandbox-visible projection of that authority set.

This distinction matters because the sandbox should not be the source of truth. A client can display a manifest, but the server should verify capability requests against the server-side surface record.

## Creation Flow

The conceptual creation flow is:

```text
model asks to create UI
  -> model supplies HTML and requested capability names
  -> registry filters requested names into a grant
  -> runtime creates a surface record
  -> runtime projects the grant into a manifest
  -> renderer sends the manifest and surface identity into the sandbox
```

Unknown, blocked, or unavailable capability names do not enter the grant.

## Request Flow

When the surface requests a capability:

```text
sandbox emits request
  -> host identifies the iframe
  -> host forwards surface identity and request
  -> server loads the surface record
  -> server checks the grant
  -> server checks policy and approval
  -> capability executes
  -> result returns to the same surface
```

The important shift is that the server checks the surface's grant. The host may do the same for user experience and fast feedback, but the server record is the authority.

## Surface Proof

The sandbox needs some way to refer to its surface.

That proof can be implemented in different ways:

- a short-lived surface token;
- a signed surface grant;
- a session-bound opaque handle;
- a server-side lookup tied to the current authenticated page;
- a capability request routed through an existing authenticated channel.

The concept is more important than the exact mechanism: a capability request should identify the surface whose grant is being used, and that identity should be checked against server-side state.

## Restoration

Restored surfaces should not rely on old sandbox state.

On restore:

1. Load the persisted surface source.
2. Recreate or verify the surface record.
3. Recompute the grant under current policy.
4. Re-sanitize the generated HTML.
5. Recreate the sandbox manifest.
6. Restore safe state only if it still matches current policy.

If a capability is no longer allowed, the restored surface should lose it.

## Lifecycle

A surface can move through lifecycle states:

- created;
- streaming;
- interactive;
- suspended;
- restored;
- revoked;
- expired;
- disposed.

The first implementation does not need every state. But naming the lifecycle helps avoid treating generated UI as anonymous DOM.

## Product Consequence

Once surfaces have identity, the product can answer important questions:

- Which surface requested this action?
- Which grant did it have?
- Which user saw it?
- Which agent turn created it?
- Which capability calls did it make?
- Which approvals did it request?
- Can it be restored?
- Can it be revoked?

That is the difference between a prototype iframe and a framework primitive.

