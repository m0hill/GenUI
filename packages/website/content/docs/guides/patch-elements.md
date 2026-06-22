# Element patches

Element patches are the primary UI update in Datastar Kit. A handler renders HTML, Datastar Kit frames it as a `datastar-patch-elements` SSE event, and Datastar applies it to the current document.

Most patches use the default `outer` mode with a stable top-level `id`.

```tsx
const CartSummary = (props: { cart: Cart }) => (
  <aside id="cart-summary">
    <strong>{props.cart.total}</strong>
  </aside>
)

return reply.patch(<CartSummary cart={cart} />)
```

Datastar matches the returned `#cart-summary` element to the existing one and morphs it.

## The three decisions

Every patch answers three questions:

| Question             | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| What is the target?  | The browser element Datastar operates on.        |
| What is the payload? | The server-rendered HTML sent in the event.      |
| What is the mode?    | The DOM operation connecting target and payload. |

For ordinary replacement, the payload chooses the target by its top-level `id`:

```tsx
return reply.patch(<TodoItem todo={todo} />)
```

Use `selector` when the target is not the returned element itself:

```tsx
return reply.patch(<TodoItem todo={todo} />, {
  selector: "#todos",
  mode: "append"
})
```

## Patch modes

| Mode      | Target                                         | Effect                                                 |
| --------- | ---------------------------------------------- | ------------------------------------------------------ |
| `outer`   | Payload top-level `id`, or explicit `selector` | Morphs the target element itself. This is the default. |
| `inner`   | `selector`                                     | Morphs only the target's children.                     |
| `replace` | Payload top-level `id`, or explicit `selector` | Replaces the target without morphing.                  |
| `prepend` | `selector`                                     | Inserts payload as the first child of the target.      |
| `append`  | `selector`                                     | Inserts payload as the last child of the target.       |
| `before`  | `selector`                                     | Inserts payload immediately before the target.         |
| `after`   | `selector`                                     | Inserts payload immediately after the target.          |
| `remove`  | `selector`                                     | Removes the target. No element payload is sent.        |

## `outer`: replace a component boundary

Use the default for stable component regions:

```tsx
const Count = (props: { value: number }) => <output id="count">{props.value}</output>

return reply.patch(<Count value={count} />)
```

This is the happy path. If a region can be refreshed from backend state, give the initial HTML and every later patch the same durable `id`.

Do not generate a fresh `id` on each render. A changing `id` turns a patch boundary into a new unrelated element.

## `inner`: refresh a container

Use `inner` when the outer element carries state, layout, or attributes that should stay in place:

```tsx
return reply.patch(<ProjectList projects={projects} />, {
  selector: "#project-panel",
  mode: "inner"
})
```

```diff
  <section id="project-panel" class="panel">
-   <p>Loading...</p>
+   <ul id="projects">...</ul>
  </section>
```

## `append` and `prepend`: add children

Use insertion modes when the payload belongs inside a container:

```tsx
return reply.patch(<TodoItem todo={todo} />, {
  selector: "#todos",
  mode: "append"
})
```

```diff
  <ul id="todos">
    <li id="todo-1">Write docs</li>
+   <li id="todo-2">Ship example</li>
  </ul>
```

Repeated items should have stable item IDs when they may be patched individually:

```tsx
const TodoItem = (props: { todo: Todo }) => <li id={`todo-${props.todo.id}`}>{props.todo.title}</li>
```

## `before` and `after`: insert siblings

Use sibling modes when the payload belongs next to a known element:

```tsx
return reply.patch(
  <p
    id="email-error"
    class="error"
  >
    Enter a valid email.
  </p>,
  { selector: "#email", mode: "after" }
)
```

```diff
  <label for="email">Email</label>
  <input id="email" name="email">
+ <p id="email-error" class="error">Enter a valid email.</p>
```

## `remove`: delete an element

Use `remove` with a selector and an empty payload:

```tsx
return reply.patch("", {
  selector: "#toast-saved",
  mode: "remove"
})
```

Datastar Kit sends a patch event without `elements` data:

```text
event: datastar-patch-elements
data: selector #toast-saved
data: mode remove
```

## View transitions

Pass `useViewTransition: true` when Datastar should opt into the browser View Transition API:

```tsx
return reply.patch(<article id="featured-card">Featured card</article>, {
  useViewTransition: true
})
```

The same option is available on `reply.patch(...)`, `event.patch(...)`, and `reply.directHtml(...)`. Patches should still work in browsers where view transitions are unavailable.

## Direct HTML responses

`reply.patch(...)` is the normal path because it sends an SSE patch event. `reply.directHtml(...)` expresses similar options through Datastar direct-response headers:

```tsx
return reply.directHtml(<TodoItem todo={todo} />, {
  selector: "#todos",
  mode: "append"
})
```

Use direct HTML responses only when an integration specifically needs Datastar direct-response behavior.

Next: [Validation](validation-and-errors.md).
