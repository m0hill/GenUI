# Generative UI Capability Runtime

These notes describe an HTML-first generative UI architecture where an AI model can create real interactive interfaces, while the application keeps authority, permissions, and side effects behind explicit capability boundaries.

This folder is intentionally conceptual. It avoids implementation-shaped code so the architecture can be rethought, reimplemented, or adapted without being anchored to one repository, AI provider, agent framework, schema library, frontend framework, or endpoint design.

## Reading Order

1. [Philosophy](00-philosophy.md) captures the primitive-first framing: Surface as the product primitive.
2. [Principles](01-principles.md) explains the core bet: HTML for generated surfaces, capabilities for authority, and JSON for protocol.
3. [Trust And Runtime](02-trust-and-runtime.md) describes the actors, sandbox boundary, host broker, server authority, and rendering pipeline.
4. [Capabilities And Permissions](03-capabilities-and-permissions.md) explains capability grants, effects, policies, approvals, and how to adapt existing agent tools.
5. [Interaction And State](04-interaction-and-state.md) explains Datastar's role, capability calls, result flow, shared state, persistence, and streaming.
6. [Extensions And JavaScript](05-extensions-and-javascript.md) covers trusted actions, plugin attributes, MCP adapters, widgets, and the narrow case for custom JavaScript.
7. [Product Hardening](06-product-hardening.md) covers threat modeling, testing, product quality, observability, and a practical roadmap.
8. [Related Approaches](07-related-approaches.md) compares this architecture with React components-as-tools, JSON UI, A2UI-style approaches, and CopilotKit-style frameworks.
9. [Reconstruction Guide](08-reconstruction-guide.md) gives a concise build order for recreating the system from scratch.
10. [Surface Runtime Model](09-surface-runtime-model.md) defines surface identity, grants, manifests, and request lifecycle.
11. [Expression Model](10-expression-model.md) captures the Datastar-vs-closed-DSL decision the framework must make.
12. [Runtime API And Packaging](11-runtime-api-and-packaging.md) describes the provider-independent public surface, adapter seams, and runtime bundling model.

## One-Sentence Version

The model may invent the interface, but every meaningful outside-world action must pass through a named, granted, policy-checked capability.

## Core Vocabulary

- **Generated surface**: the UI fragment produced by the model.
- **Surface**: the durable generated UI record: HTML, grant, descriptors, state, metadata, and identity.
- **SurfaceInstance**: a live mounted sandbox for a surface.
- **Sandbox**: the isolated iframe or equivalent execution boundary that renders the generated surface.
- **Host**: the trusted application page around the sandbox.
- **Capability**: a named operation the generated surface can request.
- **Grant**: the per-surface authority set saying which capabilities that surface is allowed to request.
- **Manifest**: the visible projection of a grant sent to the sandbox and model.
- **Broker**: trusted host or server logic that validates and executes capability requests.
- **Effect**: the risk class of a capability, such as local, read, draft, write, or dangerous.
- **Approval**: user authorization for a specific side effect, ideally bound to the exact request.

## Architectural Shape

```text
Model creates UI
  -> host grants capabilities
  -> sanitizer prepares the surface
  -> sandbox renders the UI
  -> user interacts
  -> sandbox asks host for a capability
  -> host and server validate policy
  -> capability runs
  -> result returns to the sandbox
```

The important separation is simple:

- HTML describes the interface.
- Datastar describes ordinary interaction.
- JSON carries protocol data.
- Capabilities carry authority.
- The host and server enforce trust.
