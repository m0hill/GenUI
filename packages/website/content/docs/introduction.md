# Introduction

Datastar Kit is a small TypeScript SDK for building server-driven UI with [Datastar](https://data-star.dev/).

It gives you the Datastar-shaped pieces of an application:

- native Datastar attributes in TSX, with typed actions, expressions, and signal refs from the root package;
- server-rendered HTML and TSX without a browser component runtime;
- `read.signals(request)` for Datastar action payloads;
- native `Response` helpers for pages, patches, streams, navigation, and no-content commands.

It is not a web framework. Bring your router, auth, database, validation, sessions, jobs, and deployment platform. Datastar Kit fits anywhere that can receive a Web Standard `Request` and return a `Response`.

## The model

A Datastar Kit app keeps the important state on the server and sends HTML when the browser needs to change:

1. Render the first page from backend state.
2. Put Datastar attributes on server-rendered HTML.
3. Let browser events call your handlers.
4. Mutate or read backend state in those handlers.
5. Return HTML or signal patches as ordinary `Response` objects.

The browser stays light. Datastar handles events, requests, signals, and DOM patching. Your TypeScript code owns the route behavior and renders the next view.

## Install

```sh
npm i datastar-kit
```

Datastar Kit does not bundle, install, or serve the Datastar browser runtime. This release is written and tested against Datastar `v1.0.2`; use a pinned CDN URL or a self-hosted compatible copy.

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
></script>
```

For TSX views, configure TypeScript once:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
```

## First handler

This is a complete counter in one fetch-compatible handler:

```tsx
import { post, reply } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

let count = 0

const Counter = () => (
  <main>
    <h1>Counter</h1>
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

There is no client-side counter component. The button sends a Datastar action to `/increment`; the server updates its state and returns a new `#count` element; Datastar patches the existing element in the browser.

That stable `id` is the patch contract.

## Core APIs

| Namespace         | Use it for                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Authoring helpers | Datastar actions, expressions, signal refs, and typed signal-state helpers.                              |
| `read`            | Decoding Datastar signal payloads from native `Request` values.                                          |
| `reply`           | Native `Response` helpers for pages, patches, signal patches, streams, navigation, and `204` completion. |
| `event`           | Individual SSE chunks for `reply.stream(...)`.                                                           |

## Next steps

- Read the [programming model](concepts/programming-model.md) to understand the server-driven flow.
- Learn [HTML and JSX](guides/html-and-jsx.md), [signals](guides/signals.md), and [actions and responses](guides/actions-and-responses.md) in that order.
- Use [element patches](guides/patch-elements.md) when you need selectors, insertion modes, removal, or view transitions.
- Browse [examples](guides/examples.md) when you want a complete app shape for Hono, Elysia, Deno, Bun, or Cloudflare Workers.

MIT licensed. Source is on [GitHub](https://github.com/m0hill/datastar-kit).
