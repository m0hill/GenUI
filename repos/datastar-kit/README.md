# Datastar Kit

Datastar Kit is a small TypeScript SDK for building server-driven UI with [Datastar](https://data-star.dev/).

It provides the Datastar-shaped pieces of an application: typed attributes and actions, typed signal refs, server-rendered HTML/TSX, Datastar signal decoding from `Request`, native `Response` helpers for pages, patches, streams, navigation, and no-content commands, plus a development-only debugger component.

It is not a framework. Bring your router, auth, database, validation, sessions, and runtime. Use it with Hono, Elysia, Bun, Deno, Cloudflare Workers, Node fetch adapters, or any app layer that can handle a `Request` and return a `Response`.

[Documentation](https://datastar-kit.dev) · [Examples](examples) · [Datastar](https://data-star.dev/)

## Example

```tsx
import { post, reply } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

let count = 0

const Counter = () => (
  <main>
    <button
      type="button"
      data-on:click={post("/increment")}
    >
      Increment
    </button>
    <output id="count">{count}</output>
  </main>
)

export function handle(request: Request): Response {
  const url = new URL(request.url)

  if (request.method === "GET" && url.pathname === "/") {
    return reply.page(<Counter />, {
      title: "Counter",
      head: (
        <script
          type="module"
          src={DATASTAR_RUNTIME}
        />
      )
    })
  }

  if (request.method === "POST" && url.pathname === "/increment") {
    count += 1
    return reply.patch(<output id="count">{count}</output>)
  }

  return new Response("Not Found", { status: 404 })
}
```

The stable `id` is the patch contract. The server returns new HTML for `#count`; Datastar applies it in the browser.

## Install

```sh
npm i datastar-kit
```

Datastar Kit does not bundle, install, or serve the Datastar browser runtime. This release is written and tested against Datastar `v1.0.2`; use a pinned runtime URL or a self-hosted compatible copy.

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
></script>
```

For TSX views, set `jsxImportSource`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
```

## Development debugger

Render `DatastarDebugger` in development to inspect the current signal snapshot and a compact searchable Datastar event log.

```tsx
import { DatastarDebugger } from "datastar-kit/debugger"
;<DatastarDebugger />
```

See [datastar-kit.dev](https://datastar-kit.dev) for the programming model, guides, API reference, and runnable examples.

## Repository

```sh
pnpm install
pnpm run check
```

- SDK package: [`packages/datastar-kit`](packages/datastar-kit)
- Documentation site: [`packages/website`](packages/website)
- Runnable examples: [`examples`](examples)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, source layout, and design constraints.

## License

[MIT](LICENSE) © Mohil
