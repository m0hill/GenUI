# Worker Hono live todos

A Cloudflare Workers + Hono + D1 todo app using Datastar Kit for server-rendered UI and a Durable Object live room for fan-out.

## Architecture

Use this mental model for production Cloudflare apps with Datastar Kit:

- **D1 / your database** is the source of truth.
- **The Worker** owns HTTP routes, auth, validation, database writes/reads, and rendering Datastar patches.
- **A Durable Object room** owns active SSE subscribers and fans out already-rendered Datastar events.
- **Datastar** applies the immediate action patch and live stream patches in the browser.

The Durable Object is intentionally not the database here. This example models the production shape where durable app state stays in a database and Durable Objects coordinate live streams.

## Live room pattern

Use one generic Durable Object class for many named rooms, not one global Durable Object for the whole app.

```ts
env.LIVE_ROOMS.getByName(`workspace:${workspaceId}:board`)
env.LIVE_ROOMS.getByName(`issue:${issueId}`)
env.LIVE_ROOMS.getByName(`user:${userId}:notifications`)
```

This example has one shared room:

```ts
const TODOS_ROOM = "todos"
liveRoom(env, TODOS_ROOM)
```

Choose room names by realtime/security boundaries: everyone subscribed to a room must be allowed to receive the same rendered patch.

## Request flow

On page load:

1. `GET /` reads D1 and returns the HTML page.
2. `data-init={get("/live")}` opens a Datastar SSE stream.
3. `GET /live` reads the current D1 snapshot and subscribes the tab to the `todos` Durable Object room.

On mutation:

1. The Worker validates Datastar signals and writes D1.
2. The Worker reads the latest D1 snapshot.
3. The Worker returns an immediate Datastar patch to the tab that made the request.
4. The Worker also queues a publish to the Durable Object room with `ctx.waitUntil(...)`.
5. The Durable Object fans out the same rendered patch to every connected tab.

## No room cache or version

This example intentionally keeps the live room simple: the Durable Object does **not** cache the latest patch, and D1 does **not** store a live-view version.

That means:

- every `/live` connection gets its initial patch from a fresh D1 read in the Worker;
- the Durable Object only broadcasts to tabs that are currently connected;
- there is no ordering token to maintain alongside todo writes.

For apps that need replay, missed-event recovery, or stale-publish protection inside the Durable Object, add a database-backed monotonic version and have the room cache only the latest versioned event. This example skips that extra machinery to keep the fan-out pattern clear.

## Run locally

From the repository root, apply the local D1 migration once:

```sh
pnpm --filter @datastar-kit/example-worker-hono-live-todos db:migrate:local
```

Start Wrangler:

```sh
pnpm run dev:worker-hono-live-todos
```

Open the Wrangler local URL in two tabs. Adding, toggling, or deleting a todo in either tab updates both.

## Deploy

Create/update the D1 database configured in `wrangler.jsonc` and replace `database_id` for your Cloudflare account, then apply remote migrations:

```sh
pnpm --filter @datastar-kit/example-worker-hono-live-todos db:migrate:remote
pnpm --filter @datastar-kit/example-worker-hono-live-todos deploy
```

## Typegen

This example uses Wrangler-generated `CloudflareBindings` types. Regenerate them after changing `wrangler.jsonc`:

```sh
pnpm --filter @datastar-kit/example-worker-hono-live-todos cf-typegen
```
