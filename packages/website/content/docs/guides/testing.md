# Testing

Datastar Kit is easiest to test at the same boundary it runs at: native `Request` in, native `Response` out.

## Handler tests

Prefer calling fetch-compatible handlers directly:

```ts
const response = await app.fetch(
  new Request("http://test.local/todos/add", {
    method: "POST",
    body: JSON.stringify({ title: "Ship docs" })
  })
)

expect(response.status).toBe(204)
```

This keeps tests close to production behavior and avoids framework mocks for SDK-shaped code.

For Datastar actions, build a normal request with the same JSON signal payload the browser sends:

```ts
const response = await app.fetch(
  new Request("http://test.local/todos", {
    method: "POST",
    headers: { "datastar-request": "true" },
    body: JSON.stringify({ title: "Ship docs" })
  })
)

expect(response.status).toBe(200)
expect(response.headers.get("content-type")).toBe("text/event-stream")
expect(await response.text()).toContain("datastar-patch-elements")
```

See `examples/hono-todos` for a complete app with tests that cover the initial HTML page, signal validation errors, element patches, and ordinary `404` responses.

## What to test

| Layer                     | Good coverage                                                               |
| ------------------------- | --------------------------------------------------------------------------- |
| Pure helpers              | Datastar attributes, expression rendering, HTML escaping, prop merging.     |
| Request/response handlers | `read.signals`, auth and validation behavior, `reply.*` status and headers. |
| Protocol helpers          | SSE encoding, patch options, signal patch options, stream chunks.           |
| Examples                  | Runtime wiring and copyable application patterns.                           |
| Browser behavior          | Assumptions that require the real Datastar browser runtime.                 |

Use browser/runtime tests for behavior that unit tests cannot prove, such as how Datastar applies a patch in the DOM.

Observability is app-owned. Test your logging, tracing, metrics, and OpenTelemetry setup through the platform libraries you use in production.

Next: [Examples](examples.md).
