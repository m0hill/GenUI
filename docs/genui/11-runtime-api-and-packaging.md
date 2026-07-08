# Runtime API And Packaging

This document describes the public shape of the generated UI runtime. It avoids exact code because the API should still be designed deliberately. The goal is to define the category, public concepts, package boundaries, and adapter seams without tying the idea to this demo repository.

## Category

The strongest category is:

```text
A capability runtime for generated UI, specified by a protocol and delivered as SDKs.
```

It is not primarily:

- a product, because there is no fixed end-user workflow yet;
- an app framework, because it should not own app structure;
- an MCP server, because MCP is only one possible capability source;
- a spec alone, because a working runtime proves the experience.

The runtime takes generated HTML plus requested capabilities and turns them into an isolated, interactive surface whose outside-world actions go through typed capability calls.

## Core Primitive

The top-level primitive should be **Surface**.

Surface is short, already fits the docs, and avoids collisions with component, view, artifact, workspace, or applet.

There should be a clear lifetime split:

- **Surface**: the durable record or value. It contains HTML, grant, descriptors, state, metadata, and identity.
- **SurfaceInstance** or **SurfaceHandle**: the live mounted sandbox with a message channel, lifecycle, and runtime state.

This distinction keeps persistence and restoration clean. A surface can be stored, restored, inspected, or remounted. A surface instance is what exists while it is running in a host page.

## Provider Independence

The core runtime should start after generated HTML exists.

It should accept plain data:

- generated HTML;
- requested capability names;
- optional source metadata;
- optional app context.

The HTML may come from any source:

- an LLM tool call;
- a streaming agent;
- a local model;
- a template;
- a human-written fixture;
- a persisted replay;
- a pipeline-generated document.

No core path should require an AI provider, chat loop, tool-call event shape, or agent framework.

## Public Runtime Concepts

The public API should center on a small set of concepts.

## Registry

The registry owns capabilities, grant projection, prompt projections, and execution routing.

It should not know which model or agent framework produced the surface.

## Capabilities

Capabilities are public because application developers need to define product-specific authority.

A capability definition should include:

- name;
- description;
- effect;
- input expectation;
- output expectation when useful;
- policy;
- execution behavior.

The same definition should produce:

- model instructions;
- grant descriptors;
- server execution behavior;
- inspection metadata.

## Surface Creation

Surface creation should accept generated HTML and requested capability names directly.

The runtime should:

- filter requested capabilities into a grant;
- sanitize the HTML under that grant;
- create or store surface identity;
- produce the descriptors needed by the sandbox;
- prepare the surface for mounting.

This should work without a model adapter.

Surface creation should be async. A serious runtime cannot assume the authoritative
surface record is always in the same process as the caller. The registry should accept a
pluggable `SurfaceStore`, default to an in-memory implementation for tests and local
apps, and use the same store during capability execution. This keeps the public
`Surface` value serializable while the server-side authority record remains available
after process boundaries, serverless hops, or remounts.

## Streaming Surface Creation

Streaming ingest should be a core concept, but provider-neutral.

The runtime should support a stream that can receive:

- capability names, ideally first;
- HTML chunks;
- finalization.

Provider adapters translate provider-specific partial tool-call events into this ingest API. The core runtime should not contain provider-specific partial-JSON heuristics.

## Surface Mounting

The canonical browser API should be a DOM mount operation.

Framework wrappers can exist, but they should wrap the same primitive:

- DOM mount function;
- web component;
- React wrapper;
- server-rendered helper.

All wrappers should produce the same reality: a sandboxed surface with the same bridge, broker protocol, grant behavior, and lifecycle. Wrappers should manage lifecycle, not fork runtime behavior.

The mounted instance should use `replace(surface)` rather than `update(surface)`.
Replacement recreates the sandbox document and therefore destroys sandbox-local state.
The name should make that cost explicit. Browser transports should receive an
`AbortSignal` so app code can cancel capability work when the instance is replaced or
disposed.

## Capability Execution

Capability execution should be transport-neutral.

HTTP routes, WebSocket handlers, Hono handlers, Next handlers, or tests should all be thin wrappers over the same execution operation.

The execution operation should receive plain request data plus app-provided context, check the surface grant, run policy, execute the capability, and return a structured result.

## Model Projections

The runtime can produce model-facing data, but should not call models.

Useful projections:

- a prompt contract string;
- a create-surface tool schema;
- capability descriptors;
- examples or dialect hints;
- a streaming adapter helper.

These projections are data. Provider adapters decide how to register them with OpenAI, AI SDK, Pi, LangGraph, or another agent system.

## Adapter Seams

There are two different adapter families.

## Model Adapters

Model adapters sit between an AI provider or agent framework and the surface ingest API.

They consume runtime projections:

- instructions;
- tool schema;
- capability descriptors.

They produce runtime calls:

- start surface stream;
- receive requested capabilities;
- append HTML chunks;
- finalize surface.

They should contain no policy. Policy belongs in the runtime so behavior does not fork across providers.

## Capability-Source Adapters

Capability-source adapters turn existing tool ecosystems into UI-safe capabilities.

MCP is the obvious example, but the same idea applies to app routes, RPC functions, internal services, or third-party SDKs.

These adapters should be explicit projection, not raw reflection.

They should:

- select which tools are exposed;
- assign stable product-level names;
- narrow input shapes;
- normalize outputs;
- assign effect levels;
- attach policy;
- hide integration internals.

Raw external tool metadata can inform the adapter, but it should not decide capability effect or policy by itself.

## What The Runtime Should Not Own

The runtime should not own:

- the agent loop;
- model calls;
- chat UI;
- app layout;
- app authentication;
- app session model;
- persistence backend;
- design system;
- frontend framework;
- business authorization rules;
- complete approval UX beyond a replaceable default.

The runtime should own:

- surface records;
- grant projection and checking;
- sanitization;
- isolation;
- message protocol;
- result routing;
- sandbox runtime;
- host broker behavior;
- capability execution envelope;
- runtime assets.

This boundary is what keeps the system portable.

## Package Split

A practical launch split is:

- **core**: shared types, registry, grants, surface creation, sanitizer, protocol schemas, prompt/tool projections.
- **browser**: surface mounting, host broker, web component, sandbox runtime builder, default runtime asset.
- **server**: transport-neutral handlers, surface store interface, memory store, approval records, surface tokens.
- **react**: thin component and hook over the browser mount API.
- **one model adapter**: enough to prove provider independence.
- **mcp adapter**: selected external tools projected into UI-safe capabilities.

Do not split protocol and sanitizer too early. Version skew between core, browser, and server would be more painful than a slightly larger initial package.

## Runtime Bundle

Actions, plugin attributes, and widgets are client runtime code.

The browser package needs a packaging story, not only descriptors.

A serious runtime should produce or reference a sandbox bundle that includes:

- the base bridge;
- registered local actions;
- registered plugin attributes;
- registered widgets;
- protocol handlers;
- result-state handling;
- lifecycle hooks.

The sandbox document should load that runtime from the app or runtime server. The core runtime path should not depend on a third-party CDN.

## One Definition, Multiple Projections

The important API rule:

```text
Define each extension once, then project it into every place that needs it.
```

For a capability, one definition should project into:

- model instructions;
- grant descriptors;
- execution behavior;
- inspection UI.

For a local action, one definition should project into:

- model instructions;
- sanitizer allowlist;
- sandbox runtime behavior;
- inspection UI.

For a widget, one definition should project into:

- allowed element or attribute policy;
- sandbox runtime bundle;
- model instructions;
- state and event contract.

If the same name must be copied into the prompt, sanitizer, sandbox script, and host broker by hand, the public API is not done.

## Developer Experience Test

The API is healthy when an app developer can:

- expose an existing function as a capability;
- give it a name, effect, input expectation, and policy;
- create a surface from plain HTML and requested capabilities;
- mount that surface in any host UI;
- let a model adapter produce the same surface later;
- register a local action or widget once and have it appear in model instructions, sanitizer policy, and sandbox behavior.

The developer should not need to learn the internal message protocol, iframe document assembly, sanitizer internals, bridge script, or host broker internals.

## Hello World Shape

The first demo should not require chat or a model.

It should use a canned surface "as if a model wrote it" and one small read capability. The developer should be able to remove the capability from the grant request and watch the same HTML become unable to call it.

That proves the core claim:

```text
Authority comes from the grant, not from the markup.
```

After that, plugging in a model is just an adapter exercise.

## Current Prototype Gaps

The current tracer bullet proves the architecture, but it is not yet this runtime API.

The main gaps are:

- chat concepts appear in runtime-adjacent code;
- capability context includes chat-shaped fields;
- `chat.follow_up` is special-cased in the host broker;
- public capability definitions are coupled to one schema library;
- route handling is Hono-shaped rather than transport-neutral;
- the sandbox bridge is embedded as generated script text;
- local actions and plugin attributes are described separately from their implementations;
- runtime assets are not built as an app-composed bundle;
- widgets are conceptual only;
- model instructions are tuned as one prose block rather than generated from a versioned dialect;
- route, store, renderer, and adapter APIs are not formalized.

These are productization tasks, not blockers for the architectural proof.
