# Hono form validation example

Minimal Hono + TSX example showing Datastar signal binding with server-side validation.

- `state(...)` keeps form defaults, typed refs, reset payloads, and validation patches in one place.
- `data-bind` keeps form fields in `name` and `email` signals.
- `@post('/signup')` sends the signals to the backend.
- `read.signals(request)` decodes the Datastar payload, then Zod validates it directly.
- The response patches field errors back as signals, or clears the form on success.

## Run

From the repository root:

```sh
pnpm run dev:hono-form-validation
```

Open <http://localhost:3000>.
