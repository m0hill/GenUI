# Chat example

This example integrates GenUI into a streaming chat application while keeping
model-provider and retry policy outside the SDK.

The `render_ui` model tool checks each generated code/0 fragment through
`genui/check` before creating a surface. The first invalid fragment returns
bounded diagnostics as an error tool result so the model can repair it. A
second consecutive invalid fragment ends the attempt without mounting either
fragment. Request cancellation reaches both model streaming and generated-code
checking.

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
