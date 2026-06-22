# Datastar syntax check

This is a non-runnable syntax playground for reviewing the proposed explicit modifier wrapper API.

It intentionally uses many Datastar attributes in one TSX file so the syntax can be judged before migrating the real examples.

```tsx
import { get, js, mod, post } from "datastar-kit"

data-on:submit={mod(post("/signup"), { prevent: true })}
data-on:input={mod(get("/search"), { debounce: "200ms" })}
data-signals={mod(form.defaults, { ifMissing: true })}
data-ignore={mod({ self: true })}
data-text={js`${"Search: "} + ${form.refs.search}`}
```

Use one-argument `mod({ ... })` only for presence attributes with no explicit value, such as `data-ignore__self`. Use `mod(value, { ... })` for value-bearing attributes.

Run the type check with:

```sh
pnpm --filter @datastar-kit/example-syntax-check typecheck
```
