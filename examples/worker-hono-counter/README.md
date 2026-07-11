# Worker Hono counter

A minimal Cloudflare Workers + Hono counter using Datastar Kit.

Hono routes native `Request` objects and Datastar Kit returns native `Response` objects for the full page and action patch. The count is process-local, so it is intentionally only a minimal Workers integration example.

## Run locally

From the repository root:

```sh
pnpm run dev:worker-hono-counter
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

## Deploy

```sh
pnpm --filter @datastar-kit/example-worker-hono-counter deploy
```

## Typegen

This example uses Wrangler-generated `CloudflareBindings` types. Regenerate them after changing `wrangler.jsonc`:

```sh
pnpm --filter @datastar-kit/example-worker-hono-counter cf-typegen
```
