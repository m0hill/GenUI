# GenUI

A framework for safe, model-generated interactive web UI.

The model authors an ordinary tiny web app (HTML + vanilla JS). It runs in a
locked sandbox — opaque-origin iframe, no network, no storage. The only door
out is `genui.call(name, input)`: a typed, granted, policy-checked,
human-approvable action pipeline enforced host/server-side.

See [`docs/`](docs/README.md) for the guides: defining actions, authoring
sandboxed surfaces, and hosting.

## Workspace

nub workspace:

- `packages/runtime` — `genui`: dependency-free wire contracts at
  `./protocol`, the capability kernel, and the DOM sandbox host.
- [`examples/playground`](examples/playground/README.md) — a credential-free
  Hono host with paste mode, model instructions, working fixtures, and a visible
  surface-event log.

## Develop

```sh
nub install
nub run build   # JavaScript and declarations in packages/runtime/dist/
nub run check   # format + lint + typecheck + tests for all packages
nub run test
nub run test:pack # pack, install, and import every public entrypoint
nub run eval    # evaluate incoming model output in the real sandbox
nub run dev     # playground at http://localhost:3000
```
