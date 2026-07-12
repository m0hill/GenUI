# Documentation index

- [documentation.md](documentation.md) — how to write and maintain these
  guides. Read before creating or editing any Markdown.
- [actions.md](actions.md) — define validation, model schemas, effects, policy,
  approval intent, and confidentiality once per action.
- [subscriptions.md](subscriptions.md) — define read-only event sources,
  validate every event, bound delivery, and coordinate cancellation and
  revocation.
- [code0.md](code0.md) — author and isolate buildless HTML and JavaScript
  surfaces, consume host context and styling, use granted actions and
  subscriptions plus optional host capabilities, preserve state, and handle
  graceful teardown.
- [hosting.md](hosting.md) — create and execute surfaces on a server, mount them
  with host sizing and context, transport actions and subscriptions, provide
  host capabilities, tear down safely, and expose repair events.
- [stores.md](stores.md) — implement and verify shared surface persistence,
  subscription reauthorization, idempotency, revocation, and distributed
  coordination.
- [roadmap.md](roadmap.md) — track remaining GenUI platform work, ownership
  boundaries, hardening, and the recommended implementation order.
- [playground README](../examples/playground/README.md) — run the reference host
  and evaluate model output through the real sandbox and action pipeline.
