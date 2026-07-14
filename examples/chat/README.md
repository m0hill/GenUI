# Chat example

This example integrates GenUI into a streaming chat application while keeping
model-provider and retry policy outside the SDK.

The `render_ui` model tool checks each generated code/0 fragment through the
separately installed `@genui/check` package before creating a surface. Invalid
fragments return bounded diagnostics as error tool results so the model can
repair them.
Request cancellation reaches both model streaming and generated-code checking.

This application permits three generated-interface submissions per repair
cycle. Missing, malformed, empty, oversized, unsupported, and checker-rejected
content all consume one submission. Changed valid content may recover. A third
rejection, repeated normalized invalid content, or a model that stops after a
rejection ends the cycle with a distinct fixed outcome. Other tool calls do not
consume this budget. Cancellation and operational failures stop outside the
repair cycle.

This policy belongs to the chat application. GenUI and `@genui/check` process
one fragment and do not prescribe retries, budgets, or persistence.

Each rejected submission is appended to `data/chat.jsonl` as bounded attempt
evidence. Terminal outcomes are separate records. Content within the shared
Surface limit may be retained locally. Oversized or malformed submissions keep
only type, UTF-8 byte count, and digest metadata. Attempt and outcome records
are excluded from restored chat history and future model context, and a new
chat deletes them with the rest of the session. The trusted UI renders only
fixed outcome summaries, never rejected source or diagnostic details.

The browser mounts only surfaces emitted after a successful check. GenUI's
normal surface grant, broker, schema validation, approval, and authoritative
reauthorization remain in force; the preflight check is not a security boundary.

From the repository root:

```sh
nub install
nub run --filter chat dev
```

Then open <http://localhost:3000>. The example reads OpenAI Codex OAuth
credentials from `examples/chat/auth.json`.
