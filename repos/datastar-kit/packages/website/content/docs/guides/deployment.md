# Deployment

Datastar Kit targets fetch-compatible JavaScript runtimes and stays a set of functions inside your handlers. Everything around it — server adapter, process manager, asset pipeline, session store, database, and live broker — is yours; see [Runtime boundaries](../concepts/runtime-boundaries.md) for the full split.

This page covers the few deployment concerns the SDK does touch: serving the Datastar runtime, SSE behavior through proxies, and a production checklist.

## Runtime integration

Hono, Elysia, Bun, Deno, Cloudflare Workers, Node fetch adapters, and custom routers can call Datastar Kit helpers directly:

```ts
export default {
  fetch(request: Request) {
    return app.fetch(request)
  }
}
```

Core helpers use Web Standard primitives such as `Request`, `Response`, `Headers`, `URL`, and `ReadableStream`.

## Datastar runtime asset

Datastar Kit does not serve the Datastar browser runtime; you include it yourself with a pinned CDN URL or a self-hosted copy, as shown in the [Introduction](../introduction.md#install).

For self-hosted assets, prefer immutable caching on versioned filenames:

```http
cache-control: public, max-age=31536000, immutable
```

## SSE and proxies

Datastar patches and streams use `text/event-stream`. In production:

- disable proxy buffering for SSE routes;
- keep idle/read timeouts longer than your heartbeat interval;
- avoid compression settings that buffer streaming chunks;
- smoke test through the same proxy path used in production.

For Nginx-style deployments:

```nginx
proxy_buffering off;
```

## Realtime resources

Live streams need an app-owned invalidation source — Redis, NATS, Postgres notifications, in-memory subscribers, Durable Objects, or queues — adapted into a `reply.stream(...)` event source. See [Realtime](realtime.md#invalidation-sources) for how those wire in.

## Production checklist

- Serve the Datastar browser runtime with a pinned version.
- Configure static asset caching.
- Configure SSE buffering and timeout behavior.
- Enforce auth, CSRF, ownership, request size, and rate-limit policy in app code.
- Instrument logs, traces, and metrics through your platform tooling.
- Test full-page responses, action patches, `204` command completion, signal patches, and any live streams.

Next: [Testing](testing.md).
