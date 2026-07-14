# Chat example

This example integrates GenUI into a streaming chat application while keeping
model-provider and retry policy outside the SDK.

The `render_ui` model tool checks each generated code/0 fragment through the
separately installed `@genui/check` package before creating a surface. Invalid
fragments return bounded diagnostics as error tool results so the model can
repair them. Three consecutive invalid fragments end the attempt without
mounting any of them.
Request cancellation reaches both model streaming and generated-code checking.

Each checker-rejected attempt is appended to `data/chat.jsonl` with its
generated content and structured diagnostics. These diagnostic records are
deliberately excluded from restored chat history and future model context.

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
