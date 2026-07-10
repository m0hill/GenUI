# GenUI

A framework for safe, model-generated interactive web UI.

The model authors an ordinary tiny web app (HTML + vanilla JS). It runs in a
locked sandbox — opaque-origin iframe, no network, no storage. The only door
out is `genui.call(name, input)`: a typed, granted, policy-checked,
human-approvable action pipeline enforced host/server-side.

**Read [`ROADMAP.md`](ROADMAP.md) first.** It is the single source of truth
for the goal, constitution, target architecture, milestones, testing
philosophy, and working rules.

## Workspace

pnpm workspace:

- `packages/runtime` — `@genui/genui`: dependency-free wire contracts at
  `./protocol`, the capability kernel, and the DOM sandbox host.
- `examples/playground` — a credential-free Hono host with paste mode, model
  instructions, working fixtures, and a visible surface-event log.

## Develop

```sh
pnpm install
pnpm build   # JavaScript and declarations in packages/runtime/dist/
pnpm check   # format + lint + typecheck + tests for all packages
pnpm test
pnpm test:pack # pack, install, and import every public entrypoint
pnpm eval    # evaluate incoming model output in the real sandbox
pnpm dev     # playground at http://localhost:3000
```
