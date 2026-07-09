import type { Action } from "../types.js"

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

/** Build model-facing instructions for a code/0 surface and its exact grant. */
export const codeInstructions = (actions: readonly Action[]): string => `# Generated UI: code/0

Return only an HTML fragment, without Markdown fences or a document wrapper. Use ordinary HTML,
inline CSS, and inline \`<script type="module">\` blocks. Standard browser DOM APIs are available.

The fragment runs in an opaque-origin sandbox. It has no network, storage, parent DOM access, or
external resources. Keep all JavaScript and CSS inline. Do not use fetch, WebSocket, external URLs,
external scripts, external stylesheets, or navigation.

The trusted bridge available as \`window.genui\` has exactly this API:

- \`genui.surfaceId\`: this surface's string identifier.
- \`genui.actions\`: the granted action descriptors listed below.
- \`await genui.call(name, input)\`: resolves to the action output or rejects with a
  \`GenuiActionError\` containing \`code\` and \`message\`.
- \`genui.snapshot(fn)\`: registers one state provider. The function receives restored JSON state
  when present and returns current JSON-serializable state when called without arguments.

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

## Granted actions

${actions.length === 0 ? "No actions are granted." : actions.map(actionInstructions).join("\n\n")}
`
