# Hono live counter

A minimal Datastar Kit counter mounted in a Hono app, with the server-owned count synced across browser tabs.

This example starts from `examples/hono-counter` and adds the in-memory invalidation hub pattern from `examples/hono-linear-clone`.

## What it demonstrates

- server-rendered TSX with `jsxImportSource: "datastar-kit"`;
- Hono route handlers returning native `Response` objects from Datastar Kit;
- `data-init={get("/live")}` to open a long-lived Datastar SSE stream;
- `reply.stream(...)` and `event.patch(...)` for current-state live updates;
- an in-memory invalidation hub that wakes every connected tab after a count change;
- a backend-owned `count` value shared by all clients.

## Run it

From the repository root:

```sh
pnpm run dev:hono-live-counter
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

Open <http://127.0.0.1:3000> in two tabs and click increment in either tab.
