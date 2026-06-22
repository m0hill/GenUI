# Hono counter

A minimal Datastar Kit counter mounted in a Hono app.

The example uses TSX views, Hono routes, and `reply.*` response helpers. It keeps the state on the server and returns Datastar SSE patches for focused updates.

## What it demonstrates

- server-rendered TSX with `jsxImportSource: "datastar-kit"`;
- Hono route handlers returning native `Response` objects from Datastar Kit;
- Native Datastar action attributes with typed `post(...)` expressions;
- a backend-owned `count` value;
- `reply.page(...)` for the initial document;
- `reply.patch(...)` for a focused element update.

## Run it

From the repository root:

```sh
pnpm run dev:hono-counter
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

Open <http://127.0.0.1:3000>.
