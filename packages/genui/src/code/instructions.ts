import { mcpUiStyleVariableKeys } from "../host-context.js"
import type { Action, Subscription } from "../protocol/index.js"

const hostStyleVariableInstructions = mcpUiStyleVariableKeys.map((key) => `- \`${key}\``).join("\n")

const actionInstructions = (action: Action): string => {
  const details = [
    `### ${action.name}`,
    action.description,
    `Effect: ${action.effect}`,
    `Requires approval: ${String(action.requiresApproval)}`,
  ]
  if (action.intent !== undefined) details.push(`Approval intent: ${action.intent}`)
  details.push(
    "Input JSON Schema:",
    "```json",
    JSON.stringify(action.inputSchema ?? {}, null, 2),
    "```",
  )
  return details.join("\n")
}

const subscriptionInstructions = (subscription: Subscription): string => {
  const details = [
    `### ${subscription.name}`,
    subscription.description,
    `Confidentiality: ${subscription.confidentiality}`,
    `Maximum event size: ${subscription.maxEventBytes} bytes`,
    "Input JSON Schema:",
    "```json",
    JSON.stringify(subscription.inputSchema ?? {}, null, 2),
    "```",
    "Event JSON Schema:",
    "```json",
    JSON.stringify(subscription.eventSchema ?? {}, null, 2),
    "```",
  ]
  return details.join("\n")
}

export const codeInstructions = (
  actions: readonly Action[],
  subscriptions: readonly Subscription[] = [],
): string => `# Generated UI: code/0

Return only an HTML fragment, without Markdown fences or a document wrapper. Use ordinary HTML,
inline CSS, and inline \`<script type="module">\` blocks. Standard browser DOM APIs are available.

The fragment runs in an opaque-origin sandbox. It has no network, storage, parent DOM access, or
external resources. Keep all JavaScript and CSS inline. Do not use fetch, WebSocket, EventSource,
external resource URLs, external scripts, external stylesheets, or direct navigation. Only an
\`genui.openLink\` capability can ask the host to open an external HTTPS URL.

The trusted bridge available as \`window.genui\` has exactly this API:

- \`genui.surfaceId\`: this surface's string identifier.
- \`genui.actions\`: the granted action descriptors listed below.
- \`genui.subscriptions\`: the frozen granted read-only subscription descriptors listed below.
- \`genui.hostContext\`: the current deeply frozen host environment.
- \`genui.onHostContextChange(handler)\`: registers one live-context handler.
- \`await genui.call(name, input)\`: resolves to the action output or rejects with a
  \`GenuiActionError\` containing \`code\` and \`message\`.
- \`await genui.subscribe(name, input, handler)\`: opens a granted subscription and returns a
  frozen handle with \`done\` and idempotent \`unsubscribe()\`.
- \`genui.capabilities\`: frozen booleans for optional host capabilities.
- \`await genui.sendMessage(text)\`, \`await genui.openLink(url)\`, and
  \`await genui.updateModelContext({ content?, structuredContent? })\`: optional host capabilities.
- \`genui.snapshot(fn)\`: registers one state provider. The function receives restored JSON state
  when present and returns current JSON-serializable state when called without arguments.
- \`genui.teardown(handler)\`: registers one cleanup handler that receives \`{ reason }\`. Keep it
  fast because the host proceeds with teardown after its deadline.

Handle action failures in the interface. Call only granted actions and shape inputs from their JSON
Schemas. Example:

\`\`\`html
<button id="search">Search open orders</button>
<output id="result"></output>
<script type="module">
  document.querySelector("#search").onclick = async () => {
    const orders = await genui.call("orders.search", { status: "open" })
    document.querySelector("#result").textContent = JSON.stringify(orders)
  }
</script>
\`\`\`

## Subscriptions

Subscriptions are granted read-only authority, not host capabilities. Feature-detect through
\`genui.subscriptions\`. Starting may reject, so handle that failure. Events arrive in order; the
next event waits for the current handler's returned Promise. The handle's \`done\` Promise always
resolves, including terminal errors. A thrown or rejected handler cancels only its subscription.
There is no automatic reconnect or replay.

\`\`\`html
<button id="stop" disabled>Stop live updates</button><output id="live-status"></output>
<script type="module">
  const status = document.querySelector("#live-status")
  const stop = document.querySelector("#stop")
  if (genui.subscriptions.some(({ name }) => name === "orders.changes")) {
    try {
      const stream = await genui.subscribe("orders.changes", { status: "processing" }, async event => {
        status.textContent = event.summary
      })
      stop.disabled = false
      stop.onclick = () => stream.unsubscribe()
      stream.done.then(result => {
        stop.disabled = true
        if (!result.ok) status.textContent = result.error.message
      })
    } catch (error) { status.textContent = String(error) }
  }
</script>
\`\`\`

## Host context

\`genui.hostContext\` may provide \`theme\`, \`containerDimensions\`, \`locale\`, \`timeZone\`,
and \`platform\`. Pass locale and time zone explicitly to \`Intl\`; do not rely on browser defaults.
Use platform only for small adaptations instead of user-agent sniffing. Use responsive CSS and keep
content usable inside fixed host-owned dimensions; do not resize or navigate the parent. A change
handler receives a frozen partial update; read the merged \`genui.hostContext\` inside it.

\`\`\`html
<time id="local-time"></time>
<script type="module">
  const renderHostContext = () => {
    const {
      locale = "en-US",
      timeZone = "UTC",
      platform = "web",
      containerDimensions = {},
    } = genui.hostContext
    document.querySelector("#local-time").textContent =
      new Intl.DateTimeFormat(locale, { timeZone }).format(new Date())
    document.documentElement.dataset.platform = platform
    document.documentElement.classList.toggle("fixed-height", "height" in containerDimensions)
  }
  genui.onHostContextChange(renderHostContext)
  renderHostContext()
</script>
\`\`\`

## Host capabilities

The methods \`sendMessage\`, \`openLink\`, and \`updateModelContext\` always exist. Render a control
only when its matching frozen boolean in \`genui.capabilities\` is true. \`genui.sendMessage(text)\`
asks the host to add user-role text and may trigger a model follow-up. \`genui.openLink(url)\`
accepts only absolute HTTPS URLs. \`genui.updateModelContext({ content?, structuredContent? })\`
replaces the latest UI state for future model turns without triggering an immediate follow-up.
Every method returns a Promise and may be denied; show rejection in the interface.

\`\`\`html
<div id="host-controls"></div><output id="host-status"></output>
<script type="module">
  const controls = [
    ["sendMessage", "Send selection", () => genui.sendMessage("Show my selection")],
    ["openLink", "Open details", () => genui.openLink("https://example.com/details")],
    [
      "updateModelContext",
      "Share state",
      () => genui.updateModelContext({ content: "Rows 2 and 5 selected" }),
    ],
  ]
  for (const [name, label, invoke] of controls) {
    if (!genui.capabilities[name]) continue
    const button = Object.assign(document.createElement("button"), { textContent: label })
    button.onclick = async () => {
      button.disabled = true
      try { await invoke() }
      catch (error) { document.querySelector("#host-status").textContent = String(error) }
      finally { button.disabled = false }
    }
    document.querySelector("#host-controls").append(button)
  }
</script>
\`\`\`

## Host styling

The host may provide standardized MCP Apps CSS custom properties. Use a standardized token for
every visual property it covers: colors, font families, font weights, text and heading sizes, line
heights, borders, radii, focus rings, and shadows. Do not hardcode those values directly. Hardcode
only layout geometry, spacing, and behavior for which no standardized token exists.

Reference every token through \`var(--token, fallback)\` with a sensible fallback, for example
\`var(--color-background-primary, light-dark(#ffffff, #171717))\` and
\`var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)\`.
\`light-dark()\` values follow the host's light or dark color scheme. The standardized radius token
uses the exact name \`--border-radius-sm\`. The complete standardized set is:

${hostStyleVariableInstructions}

## Granted actions

${actions.length === 0 ? "No actions are granted." : actions.map(actionInstructions).join("\n\n")}

## Granted subscriptions

${
  subscriptions.length === 0
    ? "No subscriptions are granted."
    : subscriptions.map(subscriptionInstructions).join("\n\n")
}
`
