# Related Approaches

## Why Not Only React Components

A components-as-tools approach lets developers register trusted components, then the agent chooses a component and fills props.

This is useful for:

- polished known widgets;
- strict design systems;
- charts and data grids;
- product surfaces that should be highly controlled;
- deterministic rendering.

It is less ideal for:

- open-ended UI invention;
- full-screen generated workflows;
- fast experimentation;
- streaming arbitrary layout;
- avoiding a large component catalog.

This architecture should still allow trusted components, but they should not be the only generative UI primitive.

## Why Not Only JSON UI

JSON UI lets the model describe a component tree in structured data.

This is useful for:

- validation;
- cross-platform rendering;
- design-system compliance;
- deterministic components;
- server-side inspection.

It is less ideal when the goal is open-ended, model-authored web UI.

HTML is already the web's UI language. Recreating it as JSON can make the model worse at visual expression and can create a second frontend language that the product team must maintain.

The better split is:

```text
HTML for surfaces.
JSON for manifests, protocol, state, approvals, and data.
```

## A2UI-Style Declarative UI

A2UI-style systems usually ask the model or a secondary model to produce a structured declarative UI representation. The renderer maps that representation onto known frontend components.

This can be strong for enterprise UI, design-system safety, and platform portability.

The tradeoff is that the generated UI is constrained by the schema and component catalog. That can be exactly right for some products, but it is not the same bet as HTML-first generative UI.

The useful idea to borrow is not necessarily the JSON surface format. The useful idea is the separation between generated intent, runtime rendering, state, and tool interaction.

## CopilotKit-Style Frameworks

CopilotKit-style frameworks combine several important ideas:

- frontend runtime;
- agent runtime;
- tool rendering;
- shared state;
- human-in-the-loop;
- MCP integration;
- declarative UI schemas;
- sandboxed app surfaces.

Useful ideas to borrow:

- a real runtime broker between frontend and agent;
- shared state as a first-class protocol;
- resumable approvals and interrupts;
- default renderers for tool calls;
- MCP discovery and descriptor caching;
- sandboxed iframe apps for rich surfaces;
- a taxonomy of controlled, declarative, and open-ended UI.

Things not to adopt as the primary path:

- requiring every surface to be a predefined React component;
- making JSON the main visual authoring format;
- giving generated UI broad frontend tool access;
- treating frontend-to-agent direct connections as the production authority path.

## The Useful Taxonomy

It helps to think of generative UI as three modes.

## Controlled

The developer wrote the component. The model chooses when to use it and what data to pass.

This is safest and most deterministic.

## Declarative

The model emits a structured description that a renderer maps to known components.

This balances flexibility and control.

## Open-Ended

The model creates a surface directly, usually HTML, and it runs in a sandbox.

This is most expressive and requires the strongest boundary model.

The proposed architecture focuses on open-ended HTML-first UI, while still allowing controlled and declarative widgets where they make sense.

## Strategic Position

The differentiator is not "AI can draw a card." Many systems can do that.

The differentiator is:

```text
AI can generate an entire interactive web surface,
but outside-world authority remains granted, inspectable, and brokered.
```

That is the hard product and technical problem.
