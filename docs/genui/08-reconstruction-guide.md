# Reconstruction Guide

This is the shortest path to rebuild the system from scratch without depending on the original repository.

It intentionally describes responsibilities, not exact code.

## 1. Build The Capability Registry

Create a registry that can:

- define capabilities;
- list safe descriptors;
- filter requested capability names into a lease;
- reject unknown or blocked names;
- validate inputs;
- enforce approval policy;
- execute host or server capabilities;
- return structured success or failure.

Start with a few demo capabilities:

- a local follow-up action;
- a read-only time or weather lookup;
- a deterministic palette generator;
- an approval-gated note creation action.

These are enough to test local, read, draft, and write-like effects.

## 2. Add A Create-UI Path

Give the agent a way to produce:

- generated HTML;
- requested capability names.

Store both. The HTML is the surface. The requested names are projected into a lease.

Do not treat requested names as automatically granted.

## 3. Build The Sanitizer

Create a sanitizer that:

- removes scripts and document-control elements;
- removes event handler attributes;
- restricts URLs;
- prevents direct form submission;
- allows only a narrow declarative interaction subset;
- allows only registered local actions;
- allows only registered plugin attributes;
- allows only leased capability calls;
- repairs incomplete generated HTML where practical.

Keep the sanitizer conservative. The model can try again if something is removed.

## 4. Build The Sandbox Renderer

Wrap sanitized generated HTML in a framework-owned sandbox document.

The framework owns:

- document shell;
- content security policy;
- base styles;
- trusted runtime script;
- bridge state;
- generated body insertion.

Render this document in a sandboxed iframe with minimal permissions.

## 5. Build The Sandbox Bridge

Inside the sandbox, trusted bridge code should:

- register declarative actions;
- parse capability requests;
- read simple local state values;
- post requests to the host;
- receive results;
- update local result state;
- report height;
- intercept links.

The bridge should not give generated content direct app or network authority.

## 6. Build The Host Broker

In the host page, listen for sandbox messages.

The broker should:

- identify the source iframe;
- read that iframe's lease;
- reject unknown frames;
- reject unleased capabilities;
- look up the capability descriptor;
- request approval if needed;
- run host capabilities locally;
- send server capabilities to the backend;
- return structured results to the same iframe.

This is the central browser-side safety layer.

## 7. Build The Server Endpoint

Create a trusted server path for server capabilities.

The server should:

- authenticate the user;
- validate request shape;
- validate capability input;
- check tenant and integration access;
- verify approval for writes;
- execute the capability;
- normalize the result;
- audit side effects;
- return structured success or failure.

The server should not trust the client-side lease by itself.

## 8. Add Persistence

Persist generated surfaces with:

- raw generated HTML;
- lease;
- associated chat or task;
- creation metadata;
- safe state snapshot if needed;
- approval and capability call history if needed.

On restore, re-sanitize and re-check policy.

## 9. Add Better State

Move from one global result slot to request-scoped or named result state.

Then add shared state between:

- host and generated surface;
- agent and generated surface;
- restored session and live surface.

This is what turns isolated widgets into real app surfaces.

## 10. Add Product Hardening

Before calling it production-ready, add:

- real approval UI;
- server-backed approval records;
- audit logs;
- rate limits;
- capability inspector;
- self-hosted runtime assets;
- browser tests;
- sanitizer tests;
- policy tests;
- integration tests for restored surfaces.

## Minimal Success Criteria

The architecture is working when:

- the model can create an HTML surface;
- the surface can render in a sandbox;
- the surface can use local declarative interactions;
- the surface can request a leased capability;
- unleased capabilities are blocked;
- server capabilities validate input;
- approval-gated capabilities pause for user decision;
- results return to the surface;
- the surface can be restored later under current policy.

If those are true, the core idea exists.

