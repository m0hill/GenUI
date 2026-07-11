# Realtime

Realtime is one of the smallest things you do with Datastar Kit. There is no socket server to run, no client store to sync, and no message format to design. A handler renders the current view, then renders it again whenever something changes, and Datastar patches the open page.

```tsx
import { event, reply } from "datastar-kit"

async function* todoEvents() {
  yield event.patch(<TodoList todos={await todos.all()} />)

  for await (const _ of todos.changes()) {
    yield event.patch(<TodoList todos={await todos.all()} />)
  }
}

app.get("/todos/live", (c) => reply.stream(todoEvents()))
```

`reply.stream(...)` takes the iterable, so call the generator (`todoEvents()`) rather than passing the function. Point the page at the route with `data-on:load`:

```tsx
import { get } from "datastar-kit"
;<div
  id="todos"
  data-on:load={get("/todos/live")}
/>
```

That is a complete live view. Every browser on that route now reflects the current todo list, and a new tab is correct the moment it connects.

## Why it stays simple

A realtime view is the same view you already render, returned more than once. You reuse the component, the data loader, and the request handler you wrote for the first page load. The only new piece is a source that tells the stream when to render again.

A stream sends the current view on connect, then a fresh view on every change. It does not send diffs, deltas, or events the browser has to replay. The browser never accumulates state it could get out of sync with — it just receives finished HTML.

## Live view parts

| Part                | Responsibility                                               |
| ------------------- | ------------------------------------------------------------ |
| Invalidation source | App-owned async source of "something changed" events.        |
| Load function       | Reads current backend state.                                 |
| View function       | Renders that state to HTML.                                  |
| Stream response     | Sends `event.patch(...)` chunks through `reply.stream(...)`. |

```tsx
async function* todoEvents(userId: string) {
  yield event.patch(<TodoList todos={await todos.forUser(userId)} />)

  for await (const _ of todoInvalidations.forUser(userId)) {
    yield event.patch(<TodoList todos={await todos.forUser(userId)} />)
  }
}

return reply.stream(todoEvents(user.id), {
  heartbeat: { intervalMs: 15_000, comment: "todos" }
})
```

The invalidation does not need to carry the update. It only wakes the stream so the handler can reload current backend state and render it.

## Multi-tab and multi-user sync, for free

Because every stream renders current state, you get the behaviors people usually reach for a realtime framework to build:

- **Multi-tab**: open the same page twice; a change in one tab patches the other.
- **Multi-user**: a write from one user updates every connected viewer of that data.
- **Optimistic-free correctness**: there is no client cache to reconcile, so there is nothing to roll back.

A command and a live view share the same loader and view, so they cannot drift:

```tsx
// Command: mutate, then signal the change.
app.post("/todos", async (c) => {
  const input = TodoSchema.parse(await read.signals(c.req.raw))
  await todos.create(input)
  todoInvalidations.publish() // wake the streams
  return reply.done()
})
```

The command does not render the list. It records the change and lets every open live view re-render itself.

## Invalidation sources

Anything that can become an `AsyncIterable`, `Iterable`, or `ReadableStream` works as a source: in-memory subscribers, Redis pub/sub, NATS, Postgres `LISTEN/NOTIFY`, queues, Cloudflare Durable Objects, or framework-specific channels.

Start with an in-memory hub for a single process, then swap in Redis or Durable Objects when you scale out — the handler does not change, only the source it loops over.

## Reconnect safety

The first event on a live connection should render current state. If a tab disconnects and reconnects, it must recover without needing the events it missed.

> A client recovers by reconnecting and rendering the latest backend state.

This is what keeps multi-tab and multi-process behavior simple: the stream always asks the backend what is true now, rather than replaying history.

## Heartbeats

Heartbeat comments keep long-lived SSE connections alive across proxies and platforms:

```ts
return reply.stream(events, {
  heartbeat: {
    intervalMs: 15_000,
    initialDelayMs: 15_000,
    comment: "live"
  }
})
```

Heartbeats are response behavior, so they live on `reply.stream(...)` options instead of inside the event generator. If a source needs an ad-hoc SSE comment, yield `event.comment("note")`; prefer the `heartbeat` option for regular keepalives.

## Cancellation

When your framework exposes a request `AbortSignal`, connect it to the subscription or stream source so disconnected clients do not leave subscribers running.

The exact wiring depends on the runtime. The important part is ownership: Datastar Kit writes the SSE response; your app owns the lifetime of database, broker, or in-memory subscriptions.

## Deployment

A live view usually means one SSE connection per browser tab or active view. Configure proxies to avoid buffering `text/event-stream`, keep idle timeouts longer than the heartbeat interval, and preserve streaming flush behavior. See [Deployment](deployment.md) for the proxy and timeout settings.

Next: [Security](security.md).
