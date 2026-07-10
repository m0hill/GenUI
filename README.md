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

- `packages/protocol` — `@genui/protocol`: pure wire types and codecs, zero
  dependencies.
- `packages/runtime` — `@genui/genui`: the capability kernel (actions, grants,
  policy, execution) plus the DOM host (sandboxed iframe mounting and the
  postMessage broker).
- `examples/playground` — a credential-free Hono host with paste mode, model
  instructions, working fixtures, and a visible surface-event log.

## Develop

```sh
pnpm install
pnpm build   # JavaScript and declarations in each package's dist/
pnpm check   # format + lint + typecheck + tests for all packages
pnpm test
pnpm dev     # playground at http://localhost:3000
```
