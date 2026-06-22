# API reference

Datastar Kit exposes a small root API plus explicit subpaths for low-level protocol and JSX runtime integration.

Most application code imports response namespaces and Datastar authoring helpers from the root package:

```tsx
import { event, get, js, mod, post, read, reply, state } from "datastar-kit"
```

TSX consumers should also set:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
```

## Datastar authoring helpers

The root package exports helpers for action expressions, signal refs, typed signal state, and expression serialization. Write Datastar attributes directly in TSX with native `data-*` names.

### State and signals

| API               | Use                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `state(defaults)` | Create typed leaf refs, path refs, frozen defaults, partial patches, and reset payloads.          |
| `signal(name)`    | Create a standalone typed signal ref.                                                             |
| `local(name)`     | Create an underscore-prefixed local/private signal ref.                                           |
| `StatePathError`  | Thrown when `state.ref(path)` receives a syntactically valid path that is not in the state shape. |

### Actions

| API                        | Use                                                               |
| -------------------------- | ----------------------------------------------------------------- |
| `get(url, options?)`       | Build `@get(...)`.                                                |
| `post(url, options?)`      | Build `@post(...)`.                                               |
| `put(url, options?)`       | Build `@put(...)`.                                                |
| `patch(url, options?)`     | Build `@patch(...)`.                                              |
| `del(url, options?)`       | Build `@delete(...)`.                                             |
| `peek(callable)`           | Build `@peek(...)`.                                               |
| `setAll(value, filter?)`   | Build `@setAll(...)`.                                             |
| `toggleAll(filter?)`       | Build `@toggleAll(...)`.                                          |
| `queryUrl(path, params)`   | Build a reactive URL expression with encoded query params.        |
| `action(name, ...args)`    | Call an app-defined or Datastar built-in browser action.          |
| `preserve(name, ...names)` | Build a `data-preserve-attr` space-separated attribute-name list. |

Fetch action options include `headers`, `contentType`, `filterSignals`, `payload`, retry settings, and request cancellation behavior.

Use `mod(value, modifiers)` when a value-bearing Datastar attribute needs `__modifier` suffixes. For valueless presence attributes, such as `data-ignore__self`, use the one-argument form: `data-ignore={mod({ self: true })}`.

### Datastar attributes in TSX

Use native Datastar attributes directly:

```tsx
<form
  data-signals={mod(form.defaults, { ifMissing: true })}
  data-on:submit={mod(post("/signup"), { prevent: true })}
>
  <input data-bind={form.refs.email} />
  <small
    data-show={form.refs.errors.email}
    data-text={form.refs.errors.email}
  />
</form>
```

When a Datastar attribute needs modifiers, wrap the value with `mod(value, modifiers)`:

```tsx
<input data-on:input={mod(get("/search"), { debounce: "200ms" })} />
```

Use helpers for Datastar attributes that are defined as space-separated strings. For example,
`data-preserve-attr={preserve("open", "class")}` builds the correct `"open class"` value.

### Expressions

| API                    | Use                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `js`                   | Tagged template for Datastar expressions with safe serialization of refs and literals. |
| `regex(...)`           | Build a regular expression expression value.                                           |
| `RegexExpressionError` | Thrown when regex pattern or flags cannot create a `RegExp`.                           |

## `read`

`read` contains request-boundary helpers.

| API                     | Use                                                           |
| ----------------------- | ------------------------------------------------------------- |
| `read.signals(request)` | Decode Datastar JSON signal state from a native `Request`.    |
| `read.SignalParseError` | Thrown when signal payload JSON cannot be parsed.             |
| `read.SignalShapeError` | Thrown when parsed signals are not a JSON object signal tree. |

`GET` and `DELETE` actions read the `datastar` query parameter. Other methods read the request body as JSON.

## `reply`

`reply` returns native `Response` objects.

| API                                           | Status         | Use                                                                                  |
| --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `reply.page(body, options?, init?)`           | caller-defined | Render a full HTML document.                                                         |
| `reply.patch(elements, options?, init?)`      | `200`          | Return one SSE element patch.                                                        |
| `reply.signals(value, options?, init?)`       | `200`          | Return one SSE signal patch.                                                         |
| `reply.stream(events, options?, init?)`       | `200`          | Return an SSE stream from chunks, iterables, async iterables, or a `ReadableStream`. |
| `reply.done(init?)`                           | `204`          | Complete a command with no body.                                                     |
| `reply.navigate(url, options?, init?)`        | `200`          | Navigate through a safe Datastar direct script response.                             |
| `reply.directHtml(html, options?, init?)`     | `200`          | Direct-response HTML escape hatch.                                                   |
| `reply.directSignals(value, options?, init?)` | `200`          | Direct-response JSON signal escape hatch.                                            |
| `reply.directScript(script, options?, init?)` | `200`          | Trusted direct-response JavaScript escape hatch.                                     |

Datastar action response helpers own their protocol status codes, so their native `init` type does not accept `status` or `statusText`. Use `reply.page(...)` or a plain `Response` for ordinary HTTP status semantics.

`reply.NavigationUrlError` is thrown when navigation URLs are malformed, unsafe, or disallowed by the provided navigation options.

## `event`

`event` returns framed SSE chunks for `reply.stream(...)`.

| API                               | Use                                                         |
| --------------------------------- | ----------------------------------------------------------- |
| `event.patch(elements, options?)` | Render HTML and encode one `datastar-patch-elements` event. |
| `event.signals(value, options?)`  | Encode one `datastar-patch-signals` event.                  |
| `event.navigate(url, options?)`   | Encode a safe navigation event.                             |
| `event.script(code, options?)`    | Encode trusted JavaScript execution.                        |
| `event.comment(text?)`            | Encode an SSE comment chunk for manual heartbeats.          |

Use `event.*` when one response needs multiple events or a long-lived stream.

## HTML helpers

| API                    | Use                                               |
| ---------------------- | ------------------------------------------------- |
| `renderToString(node)` | Serialize Datastar Kit HTML nodes and TSX output. |
| `unsafeHtml(html)`     | Mark trusted HTML as already safe.                |

Types exported from the root include `HtmlChild`, `HtmlNode`, `HtmlProps`, `HtmlPropValue`, `SignalState`, and `SignalValue`.

## Explicit subpaths

| Subpath                        | Use                                                                         |
| ------------------------------ | --------------------------------------------------------------------------- |
| `datastar-kit/sse`             | Low-level Datastar SSE encoders and comment chunks for custom integrations. |
| `datastar-kit/debugger`        | Development-only `DatastarDebugger` TSX component and related types.        |
| `datastar-kit/jsx-runtime`     | TypeScript automatic JSX runtime entrypoint.                                |
| `datastar-kit/jsx-dev-runtime` | TypeScript automatic JSX development runtime entrypoint.                    |

### `datastar-kit/debugger`

This subpath exports a minimal server-rendered debugger component built from ordinary Datastar attributes. Use it in development pages to inspect the current signal snapshot and a compact searchable event log of `datastar-signal-patch` plus Datastar fetch/SSE activity.

| API                            | Use                                                |
| ------------------------------ | -------------------------------------------------- |
| `DatastarDebugger(props?)`     | TSX/server-rendered debugger panel.                |
| `datastarDebuggerDefaults()`   | Initial local signal state used by the panel.      |
| `DATASTAR_DEBUGGER_STATE_NAME` | Default local signal name, `_datastarKitDebugger`. |

Types include `DatastarDebuggerProps`, `DatastarDebuggerState`, `DatastarDebuggerTab`, `DatastarDebuggerStateName`, `DatastarDebuggerEventEntry`, `DatastarDebuggerSignalPatchEntry`, and `DatastarDebuggerFetchEntry`.

Related guides: [Actions and responses](../guides/actions-and-responses.md), [Signals](../guides/signals.md), [Debugger](../guides/debugger.md), [HTML and JSX](../guides/html-and-jsx.md).
