# Changelog

## 0.4.0 - 2026-06-15

### Added

- Exposed the low-level `h(tag, props, ...children)` hyperscript factory from the root package for building `HtmlNode`s without JSX.
- Added the `datastar-kit/debugger` subpath with a compact development-only `DatastarDebugger` TSX component for inspecting current signals and searchable Datastar event activity.
- Added `state(...).ref(path)` for typed refs to any known state path, including object-valued paths.
- Added `event.comment(...)` and `datastar-kit/sse` `comment(...)` for manual SSE heartbeat comments in streams.

### Fixed

- Render bare boolean HTML children as empty strings, so `true` no longer leaks visible text into serialized markup.
- Escaped `</script>` and `<!--` sequences in `executeScript(...)` SSE output to prevent script element breakout while preserving trusted JavaScript semantics.
- Rejected control characters in SSE `id`, `selector`, and `viewTransitionSelector` fields to prevent malformed or injected event stream lines.
- Aligned SSE event helpers with Datastar defaults by omitting `retry: 1000`, ignoring `viewTransitionSelector` unless `useViewTransition` is enabled, and allowing remove-mode element patches without an elements payload.
- Split multiline SSE data payloads on CRLF, bare CR, and bare LF while preserving legitimate multiline `elements` and `signals` payloads.
- Deep-froze exposed `state(...).defaults` so runtime mutation cannot change the reset baseline.
- Preserved explicit literal unions in `state(...)` patches while still widening singleton literal defaults.
- Allowed `null` in typed `state(...).patch(...)` and `state(...).reset(...)` overrides to remove signals through Datastar patch semantics.

## 0.3.0 - 2026-06-07

### Added

- Added typed serialization for native Datastar `data-*` attributes in TSX.
- Added `mod(value, modifiers)` for native Datastar attribute modifiers, such as `data-on:submit={mod(post("/signup"), { prevent: true })}`.
- Added concise named Datastar authoring imports from the root package.
- Added `RegexExpressionError` for invalid `regex(...)` patterns or flags.

### Changed

- `regex(pattern, flags?)` now renders `new RegExp(...)` expressions instead of slash-delimited literals, so callers can pass ordinary `RegExp` constructor inputs without managing literal escaping.
- `state(...)` now exposes `defaults` for direct `data-signals={mod(state.defaults, { ifMissing: true })}` usage instead of returning attribute prop fragments.
- `queryUrl(...)` now inserts generated query parameters before URL fragments and preserves open query separators.
- `executeScript(...)` now validates generated script attribute names with the same HTML name guard used by the renderer.

### Removed

- Removed the root `ds` namespace export; import Datastar authoring helpers directly from `datastar-kit`.
- Removed the `expr(...)` public alias; use `js(...)` / `js\`...\``.
- Removed the Datastar attribute prop-fragment DSL: write native `data-*` Datastar attributes in TSX instead.
- Removed `state.attrs()`; use `data-signals={mod(state.defaults, { ifMissing: true })}`.
- Removed shallow expression aliases `sequence(...)`, `when(...)`, `peek(...)`, `setAll(...)`, and `toggleAll(...)`; use `js(...)` / `js\`...\``or`action(...)`.
- Removed public root exports for `h`, `mergeProps`, and `HtmlNameError`; TSX is the public HTML authoring path.
- Removed the unused `reply.SseChunk` wrapper shape from `reply.stream(...)`; stream chunks are now strings or `Uint8Array` values.
- Removed the awkward `delete` export alias for `del(...)`; use `del(...)` for Datastar `@delete(...)` actions.
- Removed the `state(...).$` alias; use the readable `state(...).refs` property for typed signal references.
- Removed `set(signal, value)`; write assignments with `js\`${signal} = ${value}\`` instead.

## 0.2.0 - 2026-05-27

### Added

- Added `event.navigate(url, options)` for safe browser navigation from Datastar SSE event streams.
- Exported `event.NavigationUrlError`, matching the existing `reply.NavigationUrlError` for rejected navigation targets.

### Changed

- `ds.bind()`, `ds.ref()`, and `ds.indicator()` now emit Datastar's value-form attributes by default, such as `data-bind="count"`, instead of keyed boolean attributes like `data-bind:count` when no case modifier is needed.
- `ds.dataSignal()` and `ds.dataComputed()` now preserve camelCase signal names by emitting Datastar-compatible kebab-case keyed attributes when safe, while falling back to object-valued `data-signals` or `data-computed` for names that cannot round-trip safely.
- Explicit `case` modifiers still use Datastar's native keyed syntax, preserving opt-in control over keyed attribute casing.

## 0.1.0 - 2026-05-22

- Initial public npm release of `datastar-kit`.
- Includes typed Datastar attribute/action/signal helpers, TSX/HTML rendering, signal readers, native `Response` helpers, and SSE event helpers.
