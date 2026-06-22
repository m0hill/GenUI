# Security

Auth, sessions, CSRF protection, ownership checks, and rate limiting are app concerns, not SDK ones (see [Runtime boundaries](../concepts/runtime-boundaries.md)). Apply those policies in your router, middleware, and app services before changing state.

## Command checklist

A safe Datastar command should:

1. Receive a native `Request` through the application framework.
2. Decode Datastar signals with `read.signals(request)` or use the correct platform reader for non-signal input.
3. Validate decoded input with app-owned schema and domain code.
4. Check session, authorization, CSRF, ownership, request size, and rate-limit policy.
5. Mutate backend state only after those checks pass.
6. Return a Datastar patch for recoverable UI feedback or a normal HTTP response for non-Datastar clients.

Schema validation proves shape, not authority. A valid `projectId` still needs an ownership check.

## Trust boundaries

| API                                           | Boundary                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `unsafeHtml(...)`                             | Only pass trusted or sanitized HTML.                                                 |
| `reply.directScript(...)`                     | Only pass trusted JavaScript produced by application code.                           |
| `reply.navigate(...)` / `event.navigate(...)` | Prefer these for Datastar-driven navigation because URLs are normalized and checked. |
| HTML tag and attribute names                  | Rendered names are checked; values and text are escaped by default.                  |
| Browser signals                               | Treat as user input, never as durable state or authority.                            |

## Navigation

Use relative URLs for normal in-app navigation:

```ts
return reply.navigate("/dashboard")
```

For absolute URLs, configure the navigation safety options instead of interpolating untrusted strings into scripts.

Next: [Deployment](deployment.md).
