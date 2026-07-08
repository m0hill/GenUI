# Capabilities And Permissions

## What A Capability Is

A capability is a named operation that generated UI can request but cannot execute directly.

Examples:

- submit a follow-up chat prompt;
- look up weather;
- generate a palette;
- search Notion pages;
- create a Notion draft;
- list GitHub issues;
- add a comment;
- open a host-side panel;
- fetch analytics data;
- create a calendar event.

The capability name should describe product intent, not implementation plumbing.

Good capability names are stable, namespaced, and understandable. They should feel like product actions, not raw function names.

## Capability Descriptors

The model and generated surface should receive only a descriptor.

A descriptor should answer:

- What is the capability called?
- What does it do?
- What kind of effect can it have?
- Where does it run, host or server?
- Does it require approval?

It should not expose:

- secrets;
- internal endpoint URLs;
- database details;
- integration credentials;
- raw MCP implementation details;
- hidden policy logic.

## Capability Definitions

The trusted runtime keeps the full definition.

That definition should include:

- the descriptor;
- input expectations;
- output expectations;
- policy;
- implementation;
- authorization checks;
- audit behavior;
- failure behavior.

The exact schema or validation library is not important. The important thing is that capability inputs and outputs are validated at the boundary.

## Capability Effects

Effect classification is how the system reasons about risk.

Recommended effect levels:

- **local**: affects only sandbox-local UI state.
- **read**: reads data but does not mutate durable state.
- **draft**: prepares or submits user-visible text into a controlled flow.
- **external write**: mutates durable app or third-party state.
- **dangerous**: broad, destructive, financial, privileged, or irreversible.

The effect should influence visibility, approval, logging, rate limits, and whether the capability is exposed to generated UI at all.

## Capability Policy

Each capability needs a policy.

Useful policy states:

- **allow**: the surface may call it after grant and schema checks.
- **require approval**: the surface may request it, but user approval is needed.
- **block**: the capability exists but is not available to generated UI.

The policy must be enforced both when creating the grant and when executing the request. A stale iframe or modified client should not bypass policy.

## The Grant

The grant is the per-surface authority set.

It answers:

```text
What is this generated surface allowed to ask for?
```

The grant is created from the model's requested capability names, filtered through the trusted registry and product policy.

Unknown capabilities are dropped. Blocked capabilities are dropped. Duplicates are removed. The generated surface receives only the projected descriptor list.

The grant is not final permission. It is the first gate.

## Why Grant Per Surface

The agent may have many tools, but each generated surface should have only the authority it needs.

A weather card should not be able to create Notion pages. A color palette generator should not be able to send emails. A CRM dashboard should not be able to run code.

Per-surface grants make authority inspectable:

- this card can read weather;
- this table can search issues;
- this draft form can ask to create a note;
- this dashboard can query analytics;
- this surface can do nothing outside itself.

That is much easier to reason about than giving the iframe the agent's entire tool list.

## Model Output Shape

Conceptually, the model produces two things:

1. the visible surface;
2. the list of capabilities it wants that surface to use.

Those may be physically delivered in one tool call, a multipart stream, or an event protocol. The important distinction is conceptual:

- the surface describes presentation;
- the capability request list describes desired authority.

The host treats the list as a request, not a grant.

## Execution Location

Capabilities can run in the host or on the server.

Host capabilities are for trusted browser-app behavior:

- insert a follow-up prompt;
- navigate inside the app;
- open a host panel;
- copy text through a trusted flow;
- focus or scroll app chrome.

Server capabilities are for privileged work:

- read databases;
- call external APIs;
- use MCP clients;
- access secrets;
- perform writes;
- produce audited side effects.

Generated UI should not decide where something runs. The descriptor and broker decide.

## Approval

Approval is different from a grant.

A grant says the surface may ask. Approval says the user allowed this specific effect.

For a prototype, a browser confirmation can prove the loop. For a product, approval should be a first-class object:

- tied to the current user;
- tied to the generated surface;
- tied to the capability;
- tied to the exact input or input hash;
- time-limited;
- auditable;
- reusable only when intentionally designed that way.

External writes should generally require approval. Dangerous capabilities should be blocked by default unless there is a very explicit product reason.

## Agent Tools vs UI Capabilities

Agent tools and UI capabilities overlap, but they are not the same thing.

Agent tools are designed for model planning. They may be broad, numerous, verbose, and integration-shaped.

UI capabilities are designed for user-triggered interaction. They should be narrow, stable, policy-aware, and easy to explain to a user.

The generated surface should not receive the raw agent tool namespace.

Instead, existing tools should be adapted into UI-safe capabilities.

For example, a raw Notion integration may expose a complex page creation tool. The UI-safe capability might be "create a note draft in the user's configured workspace." The capability hides parent IDs, credential details, complicated block formats, and integration internals. It adds validation, approval, and a normalized result.

This is not a second integration. It is a safer facade over the existing integration.

## Capability Registry Responsibilities

The registry should be responsible for:

- validating capability names;
- rejecting duplicates;
- hiding blocked capabilities;
- creating per-surface grants;
- validating inputs;
- validating outputs when practical;
- applying approval policy;
- returning structured success or failure;
- ensuring unknown requests fail safely.

The registry is one of the most important pieces of the system because it turns a free-form generated UI into controlled application behavior.
