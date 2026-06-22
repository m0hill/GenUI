# Runtime boundaries

Datastar Kit is intentionally narrow. It speaks Datastar from ordinary fetch-compatible handlers and leaves application policy to your app.

```ts
const signals = await read.signals(request)
const input = FormSchema.parse(signals)

await todos.create({ ownerId: user.id, title: input.title })

return reply.done()
```

The handler is still yours. Datastar Kit only handles the Datastar-specific parts around it.

## What the SDK owns

Use Datastar Kit for:

| Area                            | API                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Datastar attributes and actions | Native `data-*` TSX attributes, `post(...)`, `js`, `state(...)`                                            |
| Server HTML                     | TSX, `renderToString`, `unsafeHtml`                                                                        |
| Signal request decoding         | `read.signals(request)`                                                                                    |
| Datastar responses              | `reply.page(...)`, `reply.patch(...)`, `reply.signals(...)`, `reply.stream(...)`, `reply.done(...)`        |
| Stream chunks                   | `event.patch(...)`, `event.signals(...)`, `event.navigate(...)`, `event.script(...)`, `event.comment(...)` |
| Low-level protocol tests        | `datastar-kit/sse`                                                                                         |

The public APIs stay close to Web Standards: `Request`, `Response`, `Headers`, `URL`, `ReadableStream`, and plain objects.

## What your app owns

Keep these concerns outside the SDK:

- routing and middleware;
- auth, sessions, CSRF, ownership checks, and rate limits;
- databases, caches, queues, brokers, and subscriptions;
- validation schemas and domain error mapping;
- request-local context;
- logging, tracing, metrics, and deployment lifecycle.

That boundary is what lets the same SDK work in Hono, Elysia, Bun, Deno, Cloudflare Workers, Node adapters, and custom fetch routers.

## Request input

Use `read.signals(request)` when a Datastar action sends JSON signal state:

```ts
const state = await read.signals(request)
const input = SearchSchema.parse(state)
```

Use platform APIs for everything else:

```ts
const url = new URL(request.url)
const form = await request.formData()
const json = await request.json()
```

Datastar signals, HTML forms, query params, JSON APIs, and multipart uploads are different request inputs. Choose the reader that matches the route.

## Response output

Use `reply.*` when the browser should receive Datastar-aware responses:

```tsx
return reply.page(<TodosPage todos={todos} />)
return reply.patch(<TodoList todos={todos} />)
return reply.signals({ saved: true })
return reply.stream(events, { heartbeat: { intervalMs: 15_000 } })
return reply.navigate("/dashboard")
return reply.done()
```

Use plain `Response` objects for ordinary HTTP routes and non-Datastar clients.

Next: [HTML and JSX](../guides/html-and-jsx.md).
