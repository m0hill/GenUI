# Programming model

Datastar Kit is built around one idea: the server can remain the source of truth for interactive UI.

Instead of moving application state and rendering logic into a large browser app, you render HTML on the server, let Datastar send small requests from browser events, and return patches that update the current document. The result still feels interactive, but the important decisions stay close to your database, session, authorization, and domain code.

## The loop

Most interactions follow the same loop:

1. A page renders HTML from backend state.
2. Datastar attributes describe browser behavior, such as `data-on:click="@post('/todos/add')"`.
3. The browser sends a Datastar action request.
4. Your handler reads input, checks policy, and reads or mutates backend resources.
5. The handler returns `reply.done()`, `reply.patch(...)`, `reply.signals(...)`, or `reply.stream(...)`.
6. Datastar applies the response in the browser.

Datastar Kit exists to make steps 2, 4, and 5 pleasant in TypeScript. It does not replace the rest of your application stack.

## The four shapes

Think in these four handler shapes before reaching for individual APIs:

| Shape     | What it does                                       | Typical response                  |
| --------- | -------------------------------------------------- | --------------------------------- |
| Page      | Renders the first document or a route-level page.  | `reply.page(...)`                 |
| Command   | Accepts user intent and may mutate backend state.  | `reply.done()` or a focused patch |
| Query     | Reads current backend state for a region.          | `reply.patch(...)`                |
| Live view | Keeps a region aligned with current backend state. | `reply.stream(...)`               |

Commands should be small and explicit. Queries and live views should render from current backend state, not from assumptions about the browser's last known state.

## Signals are input, not authority

Datastar signals are browser-side values. They are useful for form fields, filters, loading flags, and local validation feedback. Treat them like any other user input:

- decode them with `read.signals(request)`;
- validate them with your schema library when shape matters;
- use them to decide what the user requested;
- read trusted values from backend resources before making durable changes.

A signal can say "the user typed this title." It should not be the authority for "this issue belongs to this user" or "the current count is 42."

## Patches are the UI contract

An element patch sends server-rendered HTML back to Datastar. For the common case, the returned element has the same stable `id` as the element already on the page:

```tsx
const TodoCount = (props: { count: number }) => <output id="todo-count">{props.count}</output>

return reply.patch(<TodoCount count={count} />)
```

Use explicit selectors only when the target is a container, a sibling position, multiple matches, or an element to remove. The [element patches](../guides/patch-elements.md) guide covers each mode.

Live views follow a current-state rule: an invalidation only means "something changed," and the handler recovers by reloading and rendering the latest backend state. The [Realtime](../guides/realtime.md#reconnect-safety) guide covers why that keeps streams simple.

## Route naming

Clear route names make the model easier to maintain:

- `GET /todos` renders the page.
- `POST /todos/add` runs a command.
- `POST /todos/:id/toggle` runs a command.
- `GET /todos/list` returns a query patch.
- `GET /todos/live` returns a live stream.

Next: [Runtime boundaries](runtime-boundaries.md).
