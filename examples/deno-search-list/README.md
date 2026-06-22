# Deno searchable list example

A small Deno app showing Datastar Kit with Deno's standard HTTP router, server-rendered TSX views, Tailwind CSS, search patches, and append-based list updates.

The example demonstrates:

- `Deno.serve(...)` with `@std/http/unstable-route`;
- server-rendered JSX through Datastar Kit's JSX runtime;
- `state(...)` for shared search/add-item signal defaults, refs, and reset patches;
- Datastar signals validated with Zod;
- search input that patches the stable `#item-list` region;
- adding a new item with `mode: "append"`.

## Run

From the repository root:

```sh
pnpm install
pnpm run dev:deno-search-list
```

Open <http://localhost:3000>.
