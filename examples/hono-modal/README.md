# Hono modal example

Minimal Hono + TSX example showing a server-rendered native `<dialog>` controlled by a Datastar signal.

- `serveStatic` serves `static/styles.css`.
- `@get('/modal')` patches the dialog into `#modal-slot`.
- `modalOpen` drives `showModal()` / `close()` with `data-effect`.

## Run

From the repository root:

```sh
pnpm run dev:hono-modal
```

Open <http://localhost:3000>.
