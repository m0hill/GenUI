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

The checker accepts a genuine `Generation`, reads its currently model-visible
code/0 declarations, and returns bounded diagnostics for invalid content. It is
an optional server-side feedback tool, not a browser package or security
boundary. A successful check does not grant authority or replace surface
creation, schema validation, current-policy projection, approval, revocation,
or browser isolation.
