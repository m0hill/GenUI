# Extensions And JavaScript

## Extension Types

The framework needs extensibility, but not all extension points should have the same authority.

There are three useful extension categories:

- capabilities;
- local actions;
- plugin attributes or components.

Each category has a different trust level.

## Capabilities

Capabilities cross the sandbox boundary.

They are the right extension point for anything that reads or mutates outside-world state:

- querying data;
- calling integrations;
- creating records;
- sending drafts;
- updating app state;
- asking the server for computed results.

Capabilities require schemas, policies, authorization, approvals, and auditability.

## Local Actions

Local actions run inside the trusted sandbox runtime.

They should be low-authority and UI-local:

- show a toast;
- set local state;
- focus a field;
- scroll within the surface;
- open or close a local panel;
- format local display state.

Local actions are useful because they let generated HTML feel interactive without crossing into app authority.

They should still be registered and allowlisted. The generated surface should not invent arbitrary action names.

## Plugin Attributes

Plugin attributes add declarative behavior to HTML.

They are useful for interaction patterns that are too awkward to express with basic bindings:

- focus when a condition becomes true;
- animate presence;
- measure an element;
- format dates;
- attach a chart renderer;
- bind keyboard shortcuts inside the sandbox;
- manage local modal focus.

The model should use plugin attributes declaratively. Developers write and review the implementation.

## Trusted Widgets

Some UI is hard to generate well with plain HTML and simple bindings.

Examples:

- charts;
- maps;
- data grids;
- code editors;
- calendars;
- file previews;
- rich text editors.

For these, the framework can provide trusted widgets. The model can place the widget declaratively and provide configuration or data, but the complex behavior comes from reviewed code.

This keeps the HTML-first approach without pretending every hard frontend problem should be hand-authored by the model every time.

## MCP And Existing Tools

Existing agent tools should not be duplicated for generated UI. They should be adapted.

An MCP server or integration may expose many tools. The UI framework should project selected tools into UI-safe capabilities.

The adapter should:

- choose which tools are safe for generated UI;
- rename them into product-level capability names;
- simplify inputs;
- normalize outputs;
- add effect metadata;
- add approval policy;
- hide credentials and raw integration details;
- cache descriptors when useful;
- support dynamic auth refresh.

The model should not see a giant raw tool list while generating UI. It should see the small set of capabilities relevant to the current surface.

## Custom JavaScript

The default answer should be no generated JavaScript.

Generated JavaScript is a different risk category from generated HTML. It turns the problem into untrusted code execution.

There are three possible modes.

## No Generated JavaScript

This is the default.

Generated surfaces use HTML, CSS, Datastar, local actions, plugin attributes, and capabilities.

Most useful product interactions should be possible in this mode if the framework has good primitives.

## Trusted Plugin JavaScript

This is the preferred escape hatch.

Developers write reviewed JavaScript once, then expose it as declarative actions, attributes, or widgets. The model uses the behavior without authoring the implementation.

This is how the system should grow.

## Permissioned Code Sandbox

This is advanced and should be treated as a separate subsystem.

If model-authored code is truly needed:

- isolate it from the DOM by default;
- avoid network access by default;
- provide a narrow API object;
- time-limit execution;
- memory-limit execution where possible;
- serialize all inputs and outputs;
- route every outside-world effect through capabilities;
- treat it as running untrusted code.

Do not casually mix this into the default generated UI iframe.

## Framework Design Implication

The framework should make the safe path powerful enough that custom JavaScript is rarely needed.

That means investing in:

- better declarative actions;
- better plugin attributes;
- trusted widgets;
- shared state;
- capability result targeting;
- high-quality examples;
- good model instructions.

The goal is not to ban JavaScript from the product. The goal is to keep JavaScript in trusted, reviewable places.

