# @genui/check

Install `@genui/check` with `genui` in server-side generation code that wants
compiler-backed code/0 preflight:

```sh
npm install genui @genui/check
```

```ts
import { checkGeneratedInterface } from "@genui/check"

const checked = await checkGeneratedInterface(generation, {
  content: generatedFragment,
  signal: request.signal,
})
if (!checked.ok) return checked.report

const surface = await generation.createSurface({ content: generatedFragment })
```

## Failure handling

Invalid generated content returns `{ ok: false, diagnostics, report }`. Send the
bounded report to model-repair policy when appropriate. `HTML:*` and `TS*`
diagnostic codes and wording are scoped to the installed checker version.

Stable `GENUI004`–`GENUI014` diagnostics cover the 102,400-byte UTF-8 Surface
limit, the 16-inline-module limit, incompatible literal nullish capability
inputs, imports, direct network and worker APIs, persistent storage, parent-page
access, direct navigation, runtime code generation, `document.currentScript`,
and unsupported HTML structures. Browser-global rules accept locally shadowed
names and recognize static properties on `window`, `self`, and `globalThis`.
They intentionally do not prove arbitrary data flow, semantic UI correctness,
or host-dependent image policy.

Both resource-limit failures are ordinary bounded invalid results, not
`GeneratedInterfaceCheckError`. Applications may reject smaller content, but
must measure UTF-8 bytes rather than JavaScript string length.

Failures outside model content reject with `GeneratedInterfaceCheckError`:

- `incompatible_generation` — the value is not a compatible GenUI
  `Generation`;
- `compiler_unavailable` — the compiler cannot be loaded or opened;
- `invalid_configuration` — checker configuration or shared declarations are
  invalid; and
- `internal_error` — an unexpected checker defect occurred.

Do not turn these exceptions into model-repair prompts. Cancellation is
separate: the checker observes it between parser and compiler phases and
rejects with the supplied `AbortSignal` reason unchanged.

The checker accepts a genuine `Generation`, reads its currently model-visible
code/0 declarations, and returns bounded diagnostics for invalid content. It is
an optional server-side feedback tool, not a browser package or security
boundary. A successful check does not grant authority or replace surface
creation, schema validation, current-policy projection, approval, revocation,
or browser isolation.
