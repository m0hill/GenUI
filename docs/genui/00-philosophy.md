# Philosophy

The goal is not to build one more AI chat product.

The goal is to find the primitive that many AI products can build on.

## The Primitive

The primitive is:

```text
Surface
```

More specifically:

```text
A generated Surface with a scoped capability Grant.
```

A surface is a bounded interactive UI artifact. It can be created by a model, restored later, mounted in different hosts, inspected, and connected to outside-world behavior only through granted capabilities.

Everything else is a product built on top:

- chat messages;
- dashboards;
- agent workspaces;
- CRM panels;
- IDE sidebars;
- document blocks;
- MCP app views;
- task-run pages;
- internal tools.

The runtime should make this primitive reliable, portable, and extensible.

## Why Primitive First

Agents do not primarily care about feature-heavy GUIs. They care about capabilities, inputs, outputs, and constraints.

That means a generated UI runtime should not start by owning a whole workflow. It should expose the smallest stable abstraction that lets many workflows emerge.

The old product question is:

```text
What feature should we build next?
```

The better question here is:

```text
What capability should others build upon?
```

## What This Means For Us

Do not overfit to chat.

Chat is a useful example host, but it should not define the runtime.

Do not overfit to MCP.

MCP is a useful capability source, but it should not define the primitive.

Do not overfit to React, Hono, Datastar, Pi, AI SDK, OpenAI, or any provider.

Those can be adapters, examples, or implementation choices. They should not be the center.

The center is:

```text
generated HTML
plus a scoped capability grant
running as an isolated surface
```

## Boring But Powerful

The best primitive should feel boring.

It should have a small vocabulary:

- Surface;
- Capability;
- Grant;
- Runtime;
- Instance.

If we need many more concepts to explain the core idea, the abstraction is probably not sharp enough.

The complexity should be compressed into the runtime:

- sanitization;
- isolation;
- capability routing;
- result delivery;
- surface lifecycle;
- adapter seams;
- extension packaging.

The developer-facing primitive should stay small.

## Extensibility Is The Moat

The runtime becomes valuable when others can extend it.

Extensions should compound:

- model adapters;
- host renderers;
- capability adapters;
- trusted widgets;
- local actions;
- plugin attributes;
- persistence stores;
- approval flows.

The runtime should make these extensions possible without letting each extension redefine the core semantics.

That means the protocol and primitive must stay stable.

## Avoid Vertical Integration Too Early

A vertical product may come later.

For example, a Jarvis-style visual agent shell might be a good product built on top of this runtime.

But building that too early would risk hiding the real primitive under one workflow's assumptions.

The runtime should first answer:

```text
Can any host app safely mount a model-generated surface with scoped capabilities?
```

If yes, many products can be built on top.

## Reminder

The primitive is not chat.

The primitive is not MCP.

The primitive is not a React component.

The primitive is not a JSON UI schema.

The primitive is:

```text
Surface = generated interface + capability grant + runtime boundary
```

