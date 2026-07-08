# Framework API And Packaging

This document describes the framework shape implied by the architecture. It avoids exact code because the API should still be designed deliberately. The goal is to name the public concepts and separate them from internal machinery.

## API Design Goal

An app developer should be able to say:

- these are the capabilities my generated surfaces may request;
- these are the local actions available inside the sandbox;
- these are the plugin attributes and widgets the sandbox runtime supports;
- these are the product instructions the model should follow;
- mount generated surfaces here;
- expose the server routes needed by the runtime.

The developer should not need to hand-write:

- message protocol plumbing;
- iframe source documents;
- content policies;
- sanitizer allowlists;
- host broker scripts;
- capability request envelopes;
- prompt fragments;
- duplicated action names across client and server.

## Public Concepts

The public framework surface should center on a few stable concepts.

## Generated UI Instance

The app creates a generated UI runtime instance. That instance owns the registry, model instructions, server routes, runtime assets, and renderer integration.

It should be the app's main integration point.

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

The framework can use that one definition to derive:

- model instructions;
- grant projection;
- runtime descriptors;
- server execution behavior;
- development inspection metadata.

## Local Actions

Local actions are public because applications need sandbox-local behavior that is not a server capability.

The API should pair the action descriptor with the action implementation. A descriptor without implementation is not enough.

The same action registration should produce:

- model instructions;
- sanitizer allowlist entries;
- sandbox runtime behavior;
- development documentation.

## Plugin Attributes

Plugin attributes are public for declarative behavior that extends HTML.

They should also pair descriptor and implementation. The framework should not require developers to edit a template string or internal bridge file to add one.

## Trusted Widgets

Widgets are public for complex UI that should be implemented once by trusted code and used declaratively by generated surfaces.

Examples include charts, maps, tables, calendars, editors, previews, and data visualizations.

The framework should treat widgets as a first-class extension type, not as an accidental escape hatch.

## Model Instruction Fragments

The framework should generate model instructions from actual registrations.

Developers may add product guidance, but capability names, action names, widget names, effect metadata, and allowed interaction rules should come from the runtime configuration.

This avoids docs and runtime drifting apart.

## Mount Or Renderer API

The app needs a simple way to render a generated surface.

The renderer should receive a surface record or surface reference, then own:

- iframe creation;
- sandbox document creation;
- manifest injection;
- surface identity injection;
- host broker hookup;
- lifecycle events.

The app should not manually construct protocol messages.

## Server Routes

The framework should expose server routes or route handlers for:

- capability execution;
- runtime assets;
- surface creation or lookup when needed;
- approval lifecycle when implemented;
- optional inspection endpoints during development.

The app should still own authentication and app-specific authorization context, but the framework should own the generated UI protocol.

## Internal Machinery

These should remain internal implementation details:

- sanitizer internals;
- iframe document assembly;
- content policy construction;
- postMessage wire protocol;
- height clamping;
- link interception;
- bridge bootstrapping;
- request ID generation;
- protocol version negotiation;
- expression evaluator internals;
- grant hashing or token shape.

Apps may configure policy, but they should not have to compose the low-level runtime pieces.

## One Definition, Three Projections

The most important API principle:

```text
Each extension should be defined once, then projected into the places that need it.
```

For a capability, one definition should project into:

- model prompt text;
- grant descriptors;
- server execution;
- inspection UI.

For a local action, one definition should project into:

- model prompt text;
- sanitizer allowlist;
- sandbox runtime behavior;
- inspection UI.

For a widget, one definition should project into:

- allowed element or attribute policy;
- sandbox runtime bundle;
- model instructions;
- state and event contract.

If the same name must be copied into three files, the framework API is not done.

## Runtime Bundle

Actions, plugin attributes, and widgets are client runtime code.

That means the framework needs a packaging story, not just a descriptor registry.

A serious framework should produce or reference a sandbox runtime bundle that includes:

- the base bridge;
- registered local actions;
- registered plugin attributes;
- registered widgets;
- protocol handlers;
- result-state handling;
- lifecycle hooks.

The sandbox document should load that runtime bundle from the app or framework server. Production applications should not depend on a third-party CDN for the core runtime path.

## Developer Experience Test

A good framework API should pass this test:

An app developer has an existing function and an input schema. They should be able to expose it to generated UI as a capability, mark its effect and policy, and let the model build UI around it without learning the message protocol, sandbox internals, sanitizer internals, or host broker.

For a local interaction, the developer should be able to register a small client implementation once and have it become available to generated surfaces, sanitizer policy, and model instructions automatically.

For a hard visual primitive, the developer should be able to register a trusted widget once and have generated surfaces use it declaratively.

## Current Prototype Gap

The current tracer bullet proves the architecture, but it is not yet this framework API.

The main gaps are:

- local actions and plugin attributes are described separately from their implementations;
- the sandbox bridge is still embedded as generated script text;
- the host broker is application-specific rather than packaged;
- runtime assets are not built as an app-composed bundle;
- widgets are conceptual only;
- prompt generation covers capabilities but not a complete extension registry;
- route and renderer APIs are not formalized.

These are productization tasks, not blockers for the architectural proof.

