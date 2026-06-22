# Hono live counter with Redis invalidations

A minimal Datastar Kit counter mounted in a Hono app, with the server-owned count synced across browser tabs through Redis pub/sub invalidations.

This example starts from `examples/hono-live-counter` and replaces the in-memory invalidation hub with Redis pub/sub.

## What it demonstrates

- server-rendered TSX with `jsxImportSource: "datastar-kit"`;
- Hono route handlers returning native `Response` objects from Datastar Kit;
- `data-init={get("/live")}` to open a long-lived Datastar SSE stream;
- `reply.stream(...)` and `event.patch(...)` for current-state live updates;
- a Redis pub/sub invalidation hub that wakes every connected tab after a count change;
- a backend-owned `count` value shared by all clients connected to this server process.

## Run it

Start Redis locally:

```sh
redis-server
```

From the repository root:

```sh
pnpm --filter @datastar-kit/example-hono-live-counter-redis dev
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

Open <http://127.0.0.1:3000> in two tabs and click increment in either tab.

By default the example connects to `redis://127.0.0.1:6379`. Override it with `REDIS_URL`.
