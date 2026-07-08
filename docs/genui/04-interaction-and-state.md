# Interaction And State

## Interaction Without Generated JavaScript

The generated surface should express most behavior declaratively.

Datastar can cover a large amount of normal UI behavior:

- local form state;
- toggles;
- tabs;
- filters;
- pending states;
- conditional sections;
- derived text;
- local style changes;
- click and submit handlers;
- effects;
- calls into trusted named actions.

The framework should grow by adding trusted declarative primitives, not by asking the model to write more JavaScript.

## Capability Calls

The generated surface should have a simple way to request a capability from user interaction.

Conceptually:

```text
When this button is clicked, ask for capability X with input Y.
```

The current prototype uses Datastar action syntax for that idea. The exact syntax can change, but the semantics should remain:

- the capability name is explicit;
- the input is structured;
- local signals can provide values;
- the request goes to the host;
- the sandbox cannot execute the capability itself.

The input language should stay intentionally small. It should support simple values and local signal references. It should not become arbitrary JavaScript.

## Request Lifecycle

A capability request should move through clear states:

```text
idle
  -> pending
  -> complete
```

or:

```text
idle
  -> pending
  -> error
```

For a minimal system, one global capability result state is enough. For a serious product, requests need names or IDs so multiple interactions can happen concurrently without overwriting each other.

The generated surface should be able to render:

- loading state;
- success state;
- validation errors;
- permission errors;
- approval-denied errors;
- capability failure;
- stale or expired state.

## Host Message Protocol

The sandbox and host need a small protocol.

The protocol should support:

- resize messages;
- safe link-open requests;
- capability requests;
- capability results;
- optional state updates;
- optional approval events.

Every message should identify the protocol version or channel. The host should ignore messages that do not match. The host should also verify the message source is a known generated surface.

The protocol should be structured data, not stringly event hacks.

## Result Flow

The result should return to the same surface that requested it.

The result should be shaped as either success or failure. It should not throw arbitrary errors into the sandbox. The surface should receive enough information to render a useful user-facing state, but not stack traces, secrets, or internal integration details.

Result details should be normalized. Generated UI should not have to understand every integration's raw response format.

## Shared State

The minimal system can keep state inside each generated surface.

A larger product needs explicit shared state between:

- host and generated surface;
- generated surface and host;
- agent and generated surface;
- server and host;
- restored sessions and live surfaces.

Useful shared state categories:

- theme;
- locale;
- timezone;
- selected app entity;
- current filters;
- capability results;
- pending approvals;
- long-running task state;
- restored UI state.

Do not dump the entire app state into generated UI. Share scoped, intentional state.

## State Direction

There are three different directions to think about.

Host to generated surface:

- safe app context;
- theme;
- selected entity;
- feature flags;
- trusted display data.

Generated surface to host:

- local user choices;
- filters;
- selected item IDs;
- requests to update host UI;
- capability requests.

Agent to generated surface:

- streamed data updates;
- surface patches;
- revised instructions;
- long-running task progress;
- replacement or disposal of a surface.

These should be protocol events, not accidental DOM coupling.

## Persistence

Generated surfaces should be restorable.

Persist enough information to reconstruct the surface:

- original generated HTML;
- capability grant;
- creation metadata;
- associated chat or task;
- safe state snapshot if needed;
- approval history;
- capability call history if audited.

On restore, re-run the sanitizer under current policy. Do not blindly trust previously sanitized HTML forever.

If policy changes and a capability is no longer allowed, restored surfaces should lose that capability.

## Streaming

HTML-first UI can stream naturally, but capability safety introduces ordering questions.

There are three practical strategies.

## Render After Completion

Wait for the generated surface and requested capabilities to finish, then render.

This is the simplest and safest. It is a good default until the product needs progressive previews.

## Progressive Preview

Stream sanitized visual HTML into a non-interactive preview. When the final grant is known, render the interactive sandbox.

This gives faster visual feedback without enabling premature actions.

## Manifest First

Require the model or planner to declare needed capabilities before the UI body streams.

This allows interaction-safe streaming earlier, but it requires a more formal protocol.

## Prompting Contract

The model should be told:

- produce fragment HTML, not a full document;
- use declarative interaction primitives;
- request capabilities by name;
- list every capability the surface uses;
- do not write scripts;
- use only the actions and attributes provided by the runtime;
- show pending, success, and error states.

This prompt contract improves output quality, but it is not the security boundary.

## Example In Words

A user asks for a weather lookup UI.

The model creates a small form with a city input and a forecast button. It asks for the weather lookup capability. The host creates a grant containing only that capability. The sandbox renders the form. When the user clicks the button, the sandbox asks the host to run the weather capability with the city value. The host checks the grant and sends the request to the server. The server validates the input, calls the weather service, returns a normalized forecast, and the sandbox renders the result.

At no point does the generated surface receive direct network access, credentials, or the ability to call arbitrary tools.
