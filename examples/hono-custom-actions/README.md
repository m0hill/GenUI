# Hono custom actions example

Hono + TSX example showing one way to move larger client-side Datastar expressions into browser-side actions and plugins.

The page is still server-rendered with Datastar Kit. For behavior that is easier to read as JavaScript, this example puts browser code in `static/datastar-actions.js` where normal editor formatting and syntax highlighting work.

## What it demonstrates

- `action(name, ...args)` for calling app-defined Datastar actions from server-rendered TSX.
- Native `data-*` TSX attributes for app-defined Datastar plugin attributes.
- A custom `@setSignal(path, value)` action that patches Datastar signals from browser code.
- A custom `@syncDialog(open)` action that calls `showModal()` / `close()` for a native dialog.
- A custom `@closeDialogOnBackdrop(path)` action that uses Datastar's `evt` context.
- A custom `data-focus-when` attribute plugin that reacts to signal changes and focuses an element.
- A normal server action (`@post('/confirm')`) returning SSE signal and element patches.

## Key files

- `src/index.tsx` — Hono routes and server-rendered TSX.
- `static/datastar-actions.js` — browser module importing Datastar and registering custom actions/plugins.
- `static/styles.css` — example styling.

The page includes only `/static/datastar-actions.js`. That module imports the pinned Datastar browser bundle and registers custom actions before Datastar's queued DOM apply pass runs.

## Run it

From the repository root:

```sh
pnpm run dev:hono-custom-actions
```

Or from this directory:

```sh
pnpm install
pnpm run dev
```

Open <http://localhost:3000>. Set `PORT=3001` (or another port) if `3000` is busy.
