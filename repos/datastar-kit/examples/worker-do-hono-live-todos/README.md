# Worker DO Hono live todos

A Cloudflare Workers + Hono todo app using Datastar Kit for server-rendered UI and a Durable Object for both SQLite persistence and live fan-out.

## Architecture

Use this mental model for Cloudflare apps that keep a small collaborative dataset inside one Durable Object:

- **The Worker** owns HTTP routes, validation, and rendering Datastar patches.
- **A named Durable Object** owns the SQLite table, mutation methods, active SSE subscribers, and fan-out.
- **Datastar** applies the immediate action patch and live stream patches in the browser.

The Worker does not talk to SQLite directly. It receives HTTP requests, gets the named Durable Object stub, calls RPC methods like `getTodos()` and `createTodo()`, renders the returned todos, and sends the HTTP response back to the browser.

## Why this works

A Durable Object is unique per ID. When the Worker calls `idFromName("todos")`, Cloudflare routes every request for that name to the same `TodoRoom` instance. That gives this example a single coordination point for the `todos` room:

- SQLite rows live in `this.ctx.storage.sql`, so todos persist after the object goes idle.
- Active live subscribers live in memory, so fan-out is fast while the object is awake.
- RPC methods run inside the Durable Object, so mutations and reads share one serialized owner.

Regular Worker instances stay stateless and can run anywhere. The named Durable Object is the tiny stateful server for this todo room.

## Room naming

Use one Durable Object class for many named todo rooms. The name is the persistence and realtime boundary: everyone connected to the same name sees the same SQLite rows and the same rendered patches.

```ts
const id = env.TODO_ROOMS.idFromName(`workspace:${workspaceId}:todos`)
const room = env.TODO_ROOMS.get(id)
```

This example has one shared room:

```ts
const TODOS_ROOM = "todos"
const room = env.TODO_ROOMS.get(env.TODO_ROOMS.idFromName(TODOS_ROOM))
```

Choose room names by data and security boundaries. Everyone who can call or subscribe to a room can receive that room's rendered todo list.

For a real app, use names that match your ownership model:

```ts
env.TODO_ROOMS.get(env.TODO_ROOMS.idFromName(`workspace:${workspaceId}:todos`))
env.TODO_ROOMS.get(env.TODO_ROOMS.idFromName(`project:${projectId}:todos`))
env.TODO_ROOMS.get(env.TODO_ROOMS.idFromName(`user:${userId}:inbox`))
```

## Request flow

On page load:

1. `GET /` calls `room.getTodos()` and returns the HTML page.
2. `data-init={get("/live")}` opens a Datastar SSE stream.
3. `GET /live` calls `room.getTodos()` for the initial patch, then subscribes the tab to the same Durable Object.

On mutation:

1. The Worker validates Datastar signals.
2. The Worker calls a Durable Object RPC method such as `room.createTodo(title)`.
3. The Durable Object writes SQLite through `this.ctx.storage.sql` and returns the latest todo snapshot.
4. The Worker renders a Datastar patch and returns it immediately to the tab that made the request.
5. The Worker also queues `room.publish(patch)` with `ctx.waitUntil(...)`.
6. The Durable Object fans out the same rendered patch to every connected tab.

## SQLite in the Durable Object

The Durable Object uses SQLite-backed storage, enabled by the `new_sqlite_classes` migration in `wrangler.jsonc`:

```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["TodoRoom"]
  }
]
```

`TodoRoom` creates its table with `CREATE TABLE IF NOT EXISTS` in the constructor and reads/writes rows with `this.ctx.storage.sql.exec(...)`.

This example intentionally uses the raw Durable Object SQLite API instead of an ORM. The goal is to teach the platform shape: Worker receives HTTP, Worker calls DO RPC, DO owns state, Worker renders Datastar patches.

## Limits and next steps

Durable Objects are single-threaded per ID. That is useful for consistency, but it also means slow work inside `TodoRoom` would block every request for the same room. Keep RPC methods small, and move slow external calls or CPU-heavy work to queues or regular Workers in production apps.

This example uses one room name, `todos`, to keep the code focused. Larger apps usually split state by tenant, workspace, document, project, chat room, or another entity boundary so independent users can work in parallel across different Durable Objects.

## Run locally

Start Wrangler:

```sh
pnpm --dir examples/worker-do-hono-live-todos dev
```

Open the Wrangler local URL in two tabs. Adding, toggling, or deleting a todo in either tab updates both.

## Deploy

Deploy the Worker. The Durable Object class migration in `wrangler.jsonc` creates the SQLite-backed Durable Object class; there is no D1 database to create or migrate.

```sh
pnpm --dir examples/worker-do-hono-live-todos deploy
```

## Typegen

This example uses Wrangler-generated `CloudflareBindings` types. Regenerate them after changing `wrangler.jsonc`:

```sh
pnpm --dir examples/worker-do-hono-live-todos cf-typegen
```
