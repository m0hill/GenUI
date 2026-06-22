# Debugger

`datastar-kit/debugger` provides a small development-only debugger component built with the same TSX and Datastar attribute authoring model as the rest of Datastar Kit.

It renders ordinary HTML. There is no custom element to register and no separate client bundle to serve.

## Add it to a page

```tsx
import { reply } from "datastar-kit"
import { DatastarDebugger } from "datastar-kit/debugger"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

export const page = () =>
  reply.page(
    <>
      <main>{/* your app */}</main>
      {process.env.NODE_ENV === "development" ? <DatastarDebugger /> : null}
    </>,
    {
      head: (
        <script
          type="module"
          src={DATASTAR_RUNTIME}
        />
      )
    }
  )
```

Do not ship the debugger in production pages. It mirrors browser-side signal state and records Datastar event payloads for developer inspection. If you want to catch `data-init` fetches, render it early in the document body before the components that start those fetches.

## What it shows

The debugger is intentionally plain: a fixed `<details>` panel with two tabs.

- **Signals**: the current browser signal snapshot as syntax-highlighted JSON, excluding the debugger's own local signal.
- **Events**: a newest-first Datastar event timeline. Rows show time, event type, and the patch target when known; otherwise they show the source element. Expand a row for syntax-highlighted JSON details; element patches show formatted HTML separately. `started` fetch events also capture the signal snapshot at that moment.

Use **Search** to filter the current tab. Plain text is case-insensitive; `/pattern/i` uses a regular expression. Use **Pause** to stop recording and **Clear** to empty the event log.

## Props

| Prop                | Default                   | Use                                                                  |
| ------------------- | ------------------------- | -------------------------------------------------------------------- |
| `id`                | `"datastar-kit-debugger"` | Container id.                                                        |
| `stateName`         | `"_datastarKitDebugger"`  | Local root signal used by the debugger. Must be underscore-prefixed. |
| `open`              | `true`                    | Whether the `<details>` panel starts expanded.                       |
| `maxEvents`         | `100`                     | Maximum debugger events retained in browser state.                   |
| `class`/`className` | none                      | Additional container class.                                          |
| `style`             | none                      | Inline container style.                                              |

## Customizing

Because the debugger is just server-rendered HTML with Datastar attributes, you can copy it, style it, or use the exported state shape as a starting point:

```tsx
import type { DatastarDebuggerState } from "datastar-kit/debugger"
```

The component stores its UI state in one local signal. By default that signal is `_datastarKitDebugger`, so it is excluded from Datastar fetch payloads by Datastar's default underscore convention.

Next: [Testing](testing.md).
