# GenUI playground

The playground is a complete credential-free Hono host for exercising GenUI
end to end. Read the [hosting guide](../../docs/hosting.md) for the reusable host
contract and [code/0 guide](../../docs/code0.md) for the guest contract.

## Run the playground

From the repository root:

```sh
nub install
nub run dev
```

Open `http://localhost:3000`. The editor starts with the orders dashboard
fixture. Use **Create surface** for paste mode, **Orders fixture** for the
working read/write flow, **Guest error fixture** for error forwarding, and
**Copy model instructions** for the manual LLM loop.

The root `dev` command builds the `genui` package and browser client before
starting the server. The event panel shows guest errors, violations, action
results, subscription starts, payload-free delivery metadata and closes,
width-and-height resize reports, host capability requests and deliveries,
graceful teardown outcomes, and audit entries.

The reference browser host supplies `en-US`, `UTC`, and `web` as its locale,
time zone, and platform context. It uses a flexible 720-pixel height cap and
the default full-width container policy.

The playground uses an app-specific `{ result, audit, approvalToken? }` HTTP
envelope to drain synchronous audit entries and carry single-use approval
tokens to the trusted parent. The approval endpoint exchanges that token for a
distinct one-time retry token. Neither token enters the sandbox. This envelope
is not part of `genui/protocol`; hosts may send audit data to any trusted sink.

The orders example also grants `orders.changes`. Its trusted browser adapter
uses a streaming server endpoint while generated code receives only
`genui.subscribe()`. The playground's stream framing is application-specific;
it is not part of `genui/protocol` and does not expose fetch, SSE, WebSocket, or
the app source to the iframe.

## Run deterministic reliability conformance

Run `nub run test:reliability` from the repository root.

The canonical corpus combines focused authored fixtures with privacy-reviewed,
sanitized model outputs. It records stable scenario IDs, generation context,
checker outcomes, browser expectations, trusted calls and events, and relevant
model provenance. CI uses only retained fixtures and never invokes a live model.

Browser scenarios cross `@genui/check`, authoritative Surface creation, the
real Playground server, the opaque-origin iframe, the broker, scripted user
interaction, and the kernel. `PREFLIGHT-AUTHORITY-007` revokes a checked and
mounted Surface before interaction to prove current trusted authority remains
decisive.

## Evaluate model output

Use the separate file-based loop for ad hoc output from any LLM:

1. Run `nub run dev`, open `http://localhost:3000`, and choose **Copy model
   instructions**.
2. Give those instructions to a model and save its raw code/0 output as
   `examples/playground/fixtures/incoming/<name>.html`.
3. Optionally add `examples/playground/fixtures/incoming/<name>.json` with the
   exact ordered startup calls to expect.
4. Run `nub run eval` from the repository root.

An expected-calls sidecar is a JSON array. Each item contains only `action` and
`input`:

```json
[
  {
    "action": "orders.search",
    "input": { "query": "Aster" }
  }
]
```

Omit the sidecar to skip call matching. Use `[]` to assert that the surface
makes no granted startup calls. The evaluator does not define selectors or an
interaction DSL; fixtures must perform behavior under test from their startup
JavaScript.

The evaluator starts the playground on an ephemeral local port and drives each
fixture through Chromium, the opaque-origin iframe, the bridge, and the real
action host. It accepts playground approval dialogs so demo writes can finish
against in-memory state. It reports mount status, guest errors, violations,
granted-call results, ungranted-call denials, and expected-call matching as a
Markdown table.

A failed fixture makes `nub run eval` exit nonzero. Its report includes every
failing assertion and the complete event log. Paste that section back to the
model when requesting a repair. This incoming-fixture evaluator is a manual
experiment, not the deterministic conformance corpus.
