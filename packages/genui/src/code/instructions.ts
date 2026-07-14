export const codeEnvironmentInstructions = (): string => `# Generated UI: code/0

Return only an HTML fragment, without Markdown fences or a document wrapper. Use ordinary HTML,
inline CSS, DOM APIs, and inline \`<script type="module">\` blocks.

## Environment and security

- The fragment runs in an opaque-origin iframe with no network, storage, parent DOM access,
  external resources, or direct navigation. Do not use fetch, WebSocket, EventSource, external
  URLs, external scripts or stylesheets, persistent storage, or parent-page APIs.
- Keep all code and styles inline. The host stores the fragment verbatim; do not depend on a build
  step or package import.
- Rendered confirmation, hidden controls, descriptor lists, and other guest state are not
  authorization. The trusted host rechecks every action and subscription.

## Selected actions and subscriptions

The separate contract declares the only available actions and subscriptions. Follow its TypeScript
declarations and exact JSON Schema fallbacks.

- \`genui.actions\` and \`genui.subscriptions\` are frozen grant snapshots. Check an action name
  with \`genui.actions.some((action) => action.name === name)\`.
- \`await genui.call(name, input)\` resolves to validated output or rejects with a
  \`GenuiActionError { code, message }\`. Catch failures and render a useful error state.
- Subscriptions are read-only authority, not host capabilities. \`await genui.subscribe(name,
  input, handler)\` may reject and returns a frozen handle with \`done\` and idempotent
  \`unsubscribe()\`. Events arrive in order after the previous handler settles. \`done\` always
  resolves, including terminal errors. There is no reconnect or replay.

## Host environment

- \`genui.hostContext\` may contain \`theme\`, \`containerDimensions\`, \`locale\`, \`timeZone\`,
  and \`platform\`. Use responsive CSS. Pass locale and time zone explicitly to \`Intl\`; do not
  resize or navigate the parent or rely on user-agent sniffing.
- \`genui.onHostContextChange(handler)\` reports partial changes. Read the merged
  \`genui.hostContext\` inside the handler.
- \`genui.capabilities\` contains only \`sendMessage\`, \`openLink\`, and \`updateModelContext\`
  booleans and does not contain actions or subscriptions. Check a flag before showing its host
  control; methods always exist but may reject. \`genui.sendMessage(text)\` may trigger a
  model follow-up; \`genui.openLink(url)\` accepts only absolute HTTPS URLs;
  \`genui.updateModelContext({ content?, structuredContent? })\` updates future model context
  without an immediate follow-up.

## Lifecycle

- \`genui.snapshot(fn)\` registers one JSON-state provider. The function receives restored state
  when present and returns current state when called without arguments.
- \`genui.teardown(handler)\` registers one cleanup handler receiving \`{ reason }\`. Finish
  promptly; the host continues after its deadline.

## Styling

Use standardized host CSS variables for every visual property they cover, with a sensible fallback
in each \`var()\`. Common tokens include \`--color-background-primary\`, \`--color-text-primary\`,
\`--color-border-primary\`, \`--color-ring-primary\`, \`--font-sans\`, \`--font-text-md-size\`,
\`--font-text-md-line-height\`, \`--border-radius-sm\`, \`--border-width-regular\`, and
\`--shadow-sm\`. Use \`light-dark()\` for theme-aware color fallbacks and a system font stack for
font fallbacks. Do not hardcode colors, typography, borders, radii, rings, or shadows. Hardcode only
layout geometry, spacing, and behavior for which no standardized token exists.
`
