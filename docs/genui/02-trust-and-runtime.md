# Trust And Runtime

## Actors

The architecture has five main actors.

## Model

The model creates the generated surface and requests the capabilities that surface needs.

The model is creative but untrusted. Its output should be treated like user-controlled content.

## Sandbox

The sandbox renders the generated surface.

The practical default is a sandboxed iframe. Other isolation mechanisms may exist, but the iframe is attractive because browsers already provide origin isolation, sandbox flags, navigation controls, and content security policy.

The sandbox should be low-authority:

- no same-origin access to the host page;
- no cookies or app credentials;
- no direct app API access;
- no direct form submission;
- no top-page navigation;
- no arbitrary network access;
- communication only through a narrow host protocol.

## Host

The host is the trusted application page around the sandbox.

It owns:

- the app shell;
- generated surface records;
- iframe registration;
- capability grant checks;
- client-side capabilities;
- approval UI;
- resizing;
- link handling;
- shared state coordination.

The host should know which iframe sent a message. It should ignore messages from unknown frames.

## Capability Registry

The registry is the trusted list of operations the product may expose to generated UI.

It defines:

- names;
- descriptions;
- risk/effect levels;
- input and output expectations;
- policies;
- execution location;
- implementations.

The generated surface sees only safe descriptors, not implementations or secrets.

## Server Runtime

The server runtime executes privileged work.

It owns:

- secrets;
- database access;
- external APIs;
- MCP clients;
- tenant and user authorization;
- durable state;
- rate limits;
- audit logs;
- policy enforcement.

The server must not trust a request merely because it came through the host. The server should validate the request again.

## Trust Zones

The system has three trust zones.

```text
Trusted server runtime
  secrets, databases, integrations, policy

Trusted host page
  app shell, iframe registry, broker, approvals

Untrusted generated sandbox
  model HTML, local state, declarative interactions
```

Every crossing between zones should be explicit:

- sandbox to host through a message protocol;
- host to server through authenticated requests;
- server to integrations through capability implementations;
- host or server back to sandbox through structured results.

Prompting is not a trust boundary. It helps the model behave, but it does not enforce safety.

## Rendering Pipeline

The conceptual pipeline is:

```text
User asks for something
  -> agent decides a generated surface would help
  -> model produces HTML and requested capability names
  -> host projects requested names into a grant
  -> sanitizer normalizes the HTML using that grant
  -> sandbox document is built
  -> sandbox renders the surface
  -> user interacts
  -> sandbox requests a capability
  -> host validates source and grant
  -> host or server executes the capability
  -> result returns to sandbox state
```

The exact implementation can vary. The important part is that rendering and authority are separated.

## Sandbox Document Ownership

The generated surface should be a fragment, not a full document.

The framework should own:

- document shell;
- content security policy;
- script imports;
- base styles;
- bridge runtime;
- initial trusted state;
- sandbox flags.

The model should own:

- visible structure;
- copy;
- layout;
- local controls;
- declarative interactions;
- capability call sites.

This prevents the model from redefining the runtime environment.

## Iframe Policy

The default iframe should allow only the minimum required for the trusted runtime to work.

Usually that means scripts are allowed, but same-origin access, direct forms, popups, top navigation, downloads, and broad browser permissions are not.

If the product needs any of those behaviors, expose them as explicit host-mediated capabilities instead of widening the whole sandbox.

## Content Security Policy

The sandbox should have a restrictive content security policy.

The policy should generally:

- deny everything by default;
- allow only trusted runtime scripts;
- allow inline styles only if needed for generated layout;
- restrict images or proxy them;
- prevent direct form submissions;
- prevent nested frames;
- prevent arbitrary network connections;
- prevent plugins and objects;
- prevent the generated content from changing document base behavior.

Some declarative runtimes compile expressions internally. If that requires eval-like behavior, keep that permission inside the sandbox only. Do not weaken the host page's policy for generated UI.

## Sanitization As One Layer

Sanitization is required but not sufficient.

It should remove:

- scripts;
- document-control tags;
- nested frames;
- object and embed content;
- event handler attributes;
- unsafe URLs;
- direct form actions;
- unregistered runtime actions;
- ungranted capability calls;
- unsafe expressions.

Sanitization should also repair incomplete streamed HTML when possible.

But the system should assume sanitization may miss something. The iframe sandbox, host broker, server validation, policies, and approvals are all separate layers.

## Link And Resize Handling

Generated surfaces often need to resize and contain links.

The sandbox should report height to the host. The host clamps that height so a generated surface cannot take over the page.

Links should be intercepted. The sandbox asks the host to open a link, and the host decides whether the URL is safe.

This keeps navigation authority outside the generated surface.
