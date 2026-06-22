# Hono todos

A small Datastar Kit todo app mounted in Hono with focused request/response tests.

This example starts from the same shape as `examples/hono-counter`: Hono owns routing, Datastar Kit owns TSX rendering, signal decoding, and Datastar responses. The difference is that this app includes tests that call the same Hono `app.fetch(...)` boundary used in production.

## What it demonstrates

- server-rendered TSX with `jsxImportSource: "datastar-kit"`;
- Hono route handlers returning native `Response` objects from Datastar Kit;
- `read.signals(...)` for Datastar action payloads;
- `reply.page(...)`, `reply.patch(...)`, `reply.signals(...)`, and `reply.stream(...)`;
- a backend-owned todo list;
- tests that inspect HTML, status codes, headers, and SSE response bodies directly.

## Run it

From the repository root:

```sh
pnpm run dev:hono-todos
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

Open <http://127.0.0.1:3000>.

## Test it

From the repository root:

```sh
pnpm --filter @datastar-kit/example-hono-todos test
```

The tests create normal `Request` objects, call `app.fetch(...)`, and inspect native `Response` objects. Use that pattern for most Datastar Kit tests before reaching for a browser runner.
