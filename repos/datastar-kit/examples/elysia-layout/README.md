# Elysia layout example

A small Bun/Elysia app showing how Datastar Kit JSX handles ordinary application layout concerns:

- an app shell with sidebar and topbar regions;
- named layout slots via normal JSX props (`sidebar`, `toolbar`, `children`);
- route-level data loading before rendering;
- a Datastar form action that patches only the stable `#project-list` region and clears the typed `state(...)` input signal.

This example uses Datastar Kit's JSX runtime and `reply.*` helpers directly. It does not use `@elysia/html` because `reply.page(...)`, `reply.patch(...)`, and `reply.stream(...)` already return native `Response` objects with the correct Datastar/HTML headers.

## Run

From the repository root:

```sh
pnpm install
pnpm run dev:elysia-layout
```

Open <http://localhost:3000>.

## Starting from a fresh Elysia app

If you want to recreate this outside the workspace, start with Elysia's Bun scaffold and add Datastar Kit:

```sh
bun create elysia app
cd app
bun add datastar-kit
```

Configure TypeScript for Datastar Kit's automatic JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
```
