# Principles

## The Core Bet

Generative UI becomes powerful when the model can create the actual interface, not just choose from a fixed list of cards.

The model should be able to produce a weather tool, planning board, invoice explorer, analytics view, mini CRM screen, form workflow, or full-screen task surface as HTML. But the model should not automatically gain the authority to read secrets, call integrations, write to databases, submit forms, or mutate user data.

The guiding rule:

```text
The model owns presentation.
The application owns authority.
```

## HTML As The Surface Language

HTML and CSS are the natural authoring target for open-ended generated UI.

They are worth using because they are:

- familiar to models;
- flexible enough for almost any layout;
- streamable;
- framework-independent;
- inspectable;
- easy to normalize;
- easy to embed in a sandbox;
- backed by browser standards for forms, accessibility, media, and layout.

This does not mean every generated interface will be beautiful or correct. It means HTML gives the model a native, expressive language instead of forcing it through an invented UI schema for every visual decision.

## Capabilities As The Authority Language

Generated HTML should not call the outside world directly.

Instead, it should ask for named capabilities. A capability is a product-level operation, such as looking up weather, drafting a message, creating a note, searching Notion, listing GitHub issues, or opening a host-side panel.

The capability boundary changes the problem from:

```text
Can we safely run arbitrary model-authored JavaScript?
```

to:

```text
Can we safely broker a known request for a known operation?
```

That second problem is much more tractable.

## JSON As The Protocol Language

JSON is useful, but it should not be the main visual authoring language.

Use HTML for:

- layout;
- text hierarchy;
- forms;
- tables;
- visual composition;
- generated surfaces;
- progressive rendering.

Use JSON for:

- capability manifests;
- capability inputs and outputs;
- protocol messages;
- approval records;
- state patches;
- audit logs;
- persisted metadata.

The split is:

```text
HTML for what the user sees.
JSON for what the system must validate.
```

## Datastar As The Declarative Interaction Layer

Generated UI needs interaction, but it should not need arbitrary JavaScript for normal behavior.

Datastar is useful because it lets generated HTML express common interactions declaratively:

- local state;
- input bindings;
- show and hide behavior;
- text updates;
- class and style changes;
- click and submit reactions;
- lightweight effects;
- named actions.

The framework can add trusted Datastar actions and plugin attributes over time. The model then composes those primitives in HTML, while reviewed runtime code performs the behavior.

## Why Not Raw Generated JavaScript

The risky part of generative UI is not drawing UI. The risky part is giving untrusted output an execution environment.

Arbitrary generated JavaScript can attempt to:

- read app state;
- access cookies or storage;
- make network requests;
- create hidden forms;
- navigate the page;
- imitate permission dialogs;
- probe browser APIs;
- consume resources;
- bypass product policy.

The safer default is:

```text
No generated scripts.
Trusted runtime scripts only.
Declarative generated markup.
Brokered capability calls.
```

This does not mean JavaScript never exists. It means JavaScript belongs to the trusted framework, trusted plugins, or a deliberately separate permissioned code sandbox.

## Least Privilege Per Surface

A generated surface should not inherit every tool the agent has.

Each surface should receive a narrow grant: a small list of capabilities it may request. A weather card should not receive access to Notion writes. A Notion draft surface should not receive access to shell commands. A chart should not receive access to the user's inbox.

Per-surface authority is the foundation of the design.

## The Framework Should Stay Boring

The architecture should prefer clear boundaries over cleverness:

- small named capabilities;
- explicit grants;
- schema validation;
- sandbox isolation;
- host mediation;
- server-side policy;
- audit logs;
- real approval flows.

The model can be creative. The runtime should be predictable.

## Final Principles

- HTML is the UI language.
- JSON is the protocol language.
- Datastar is the default interaction language.
- The sandbox is the execution boundary.
- The grant is the authority set.
- The manifest is the sandbox-visible projection of that grant.
- The host is the broker.
- The server is the authority.
- Capabilities are the only bridge to outside-world effects.
- Existing tools should be adapted into UI-safe capabilities, not exposed raw.
- Generated JavaScript is not the default path.
