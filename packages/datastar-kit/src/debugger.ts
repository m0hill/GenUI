import { h, type HtmlChild } from "./html.js"

export const DATASTAR_DEBUGGER_STATE_NAME = "_datastarKitDebugger" as const

export type DatastarDebuggerStateName = `_${string}`
export type DatastarDebuggerTab = "signals" | "events"

export interface DatastarDebuggerSignalPatchEntry {
  readonly at: string
  readonly kind: "signal"
  readonly patch: unknown
}

export interface DatastarDebuggerFetchEntry {
  readonly at: string
  readonly kind: "fetch"
  readonly type: string
  readonly element: string
  readonly target?: string
  readonly argsRaw: Readonly<Record<string, unknown>>
  readonly signals?: Readonly<Record<string, unknown>>
}

export type DatastarDebuggerEventEntry =
  | DatastarDebuggerSignalPatchEntry
  | DatastarDebuggerFetchEntry

export interface DatastarDebuggerState {
  readonly tab: DatastarDebuggerTab
  readonly search: string
  readonly paused: boolean
  readonly events: readonly DatastarDebuggerEventEntry[]
}

export interface DatastarDebuggerProps {
  /** Container `id`. @defaultValue `"datastar-kit-debugger"` */
  readonly id?: string
  /** Local signal name used by the debugger. Must be one underscore-prefixed root signal. */
  readonly stateName?: DatastarDebuggerStateName
  /** Whether the `<details>` panel starts open. @defaultValue `true` */
  readonly open?: boolean
  /** Maximum debugger events retained in browser signal state. @defaultValue `100` */
  readonly maxEvents?: number
  /** Additional class on the debugger container. */
  readonly class?: string
  /** Additional class on the debugger container for JSX callers that prefer `className`. */
  readonly className?: string
  /** Inline style on the debugger container. */
  readonly style?: string
}

const DEBUGGER_CLASS = "datastar-kit-debugger"
const DEBUGGER_ID = "datastar-kit-debugger"
const DEFAULT_MAX_EVENTS = 100
const MAX_DEBUG_STRING_LENGTH = 2_000

const localStateNamePattern = /^_[A-Za-z][A-Za-z0-9_]*$/

const debuggerStyles = `
.${DEBUGGER_CLASS} {
  display: contents;
  color-scheme: dark;
  --dsk-bg: #000;
  --dsk-surface: #0c0c0c;
  --dsk-surface-2: #161616;
  --dsk-border: #1f1f1f;
  --dsk-border-strong: #333;
  --dsk-text: #ededed;
  --dsk-muted: #7d7d7d;
  --dsk-faint: #565656;
  --dsk-add: #5fb46a;
  --dsk-blue: #7aa2f7;
  --dsk-red: #f0666f;
  --dsk-mono: "SFMono-Regular", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", monospace;
  font: 12px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.${DEBUGGER_CLASS} * { box-sizing: border-box; }
.${DEBUGGER_CLASS} details {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 2147483647;
  width: min(92vw, 33rem);
  max-height: min(74vh, 38rem);
  overflow: auto;
  border: 1px solid var(--dsk-border);
  border-radius: 0.75rem;
  background: var(--dsk-bg);
  color: var(--dsk-text);
  box-shadow: 0 24px 70px -16px rgb(0 0 0 / 85%);
}
.${DEBUGGER_CLASS} details:not([open]) { width: auto; }
.${DEBUGGER_CLASS} summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: center;
  cursor: pointer;
  padding: 0.8rem 1rem;
  list-style: none;
  user-select: none;
  transition: background 0.12s ease;
}
.${DEBUGGER_CLASS} summary:hover { background: var(--dsk-surface); }
.${DEBUGGER_CLASS} summary::-webkit-details-marker { display: none; }
.${DEBUGGER_CLASS} .dsk-debug-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dsk-text);
}
.${DEBUGGER_CLASS} .dsk-debug-pill:first-of-type { margin-left: auto; }
.${DEBUGGER_CLASS} .dsk-debug-pill {
  color: var(--dsk-muted);
  font-size: 11px;
  font-family: var(--dsk-mono);
  font-variant-numeric: tabular-nums;
}
.${DEBUGGER_CLASS} .dsk-debug-pill[data-kind="warn"] {
  color: var(--dsk-red);
  font-weight: 600;
}
.${DEBUGGER_CLASS} .dsk-debug-body {
  display: grid;
  gap: 1.1rem;
  padding: 1rem;
  border-top: 1px solid var(--dsk-border);
}
.${DEBUGGER_CLASS} .dsk-debug-controls {
  display: flex;
  gap: 0.45rem;
  align-items: stretch;
}
.${DEBUGGER_CLASS} .dsk-debug-controls input { flex: 1 1 auto; min-width: 0; }
.${DEBUGGER_CLASS} .dsk-debug-tabs {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  padding: 0.3rem;
  border: 1px solid var(--dsk-border);
  border-radius: 0.6rem;
  background: var(--dsk-surface);
}
.${DEBUGGER_CLASS} input,
.${DEBUGGER_CLASS} button {
  border: 1px solid var(--dsk-border);
  border-radius: 0.5rem;
  background: var(--dsk-surface);
  color: var(--dsk-text);
  font: inherit;
  padding: 0.45rem 0.65rem;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.${DEBUGGER_CLASS} input { flex: 1 1 12rem; background: var(--dsk-surface-2); }
.${DEBUGGER_CLASS} input::placeholder { color: var(--dsk-faint); }
.${DEBUGGER_CLASS} input:focus-visible {
  outline: none;
  border-color: var(--dsk-border-strong);
}
.${DEBUGGER_CLASS} .dsk-debug-controls button {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  padding: 0;
  color: var(--dsk-muted);
  background: var(--dsk-surface-2);
}
.${DEBUGGER_CLASS} .dsk-debug-controls button:hover {
  color: var(--dsk-text);
  border-color: var(--dsk-border-strong);
  background: #1f1f1f;
}
.${DEBUGGER_CLASS} .dsk-debug-controls button svg { display: block; }
.${DEBUGGER_CLASS} .dsk-debug-tabs button {
  flex: 1;
  cursor: pointer;
  font-weight: 600;
  border-color: transparent;
  background: transparent;
  color: var(--dsk-muted);
}
.${DEBUGGER_CLASS} .dsk-debug-tabs button:hover:not([aria-selected]:not([aria-selected="false"])) {
  color: var(--dsk-text);
}
.${DEBUGGER_CLASS} .dsk-debug-tabs button[aria-selected]:not([aria-selected="false"]) {
  background: var(--dsk-surface-2);
  color: #fff;
}
.${DEBUGGER_CLASS} .dsk-debug-controls button[aria-pressed]:not([aria-pressed="false"]) {
  border-color: var(--dsk-border-strong);
  background: var(--dsk-surface-2);
  color: var(--dsk-text);
}
.${DEBUGGER_CLASS} .dsk-debug-panel { display: grid; gap: 0.6rem; }
.${DEBUGGER_CLASS} h3 {
  margin: 0;
  color: var(--dsk-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.${DEBUGGER_CLASS} pre {
  max-height: 18rem;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--dsk-border);
  border-radius: 0.5rem;
  background: var(--dsk-surface-2);
  color: var(--dsk-text);
  padding: 0.75rem 0.85rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 11px/1.6 var(--dsk-mono);
}
.${DEBUGGER_CLASS} .dsk-debug-events {
  display: grid;
  gap: 0.45rem;
}
.${DEBUGGER_CLASS} .dsk-debug-event {
  position: static;
  width: auto;
  max-height: none;
  overflow: hidden;
  border: 1px solid var(--dsk-border);
  border-radius: 0.5rem;
  background: var(--dsk-surface-2);
  box-shadow: none;
}
.${DEBUGGER_CLASS} .dsk-debug-event[open] { border-color: var(--dsk-border-strong); }
.${DEBUGGER_CLASS} .dsk-debug-event summary {
  flex-wrap: nowrap;
  min-width: 0;
  padding: 0.55rem 0.7rem;
  border: 0;
  font-weight: 500;
  gap: 0.6rem;
  font-family: var(--dsk-mono);
  font-size: 11px;
}
.${DEBUGGER_CLASS} .dsk-debug-event summary:hover { background: #1f1f1f; }
.${DEBUGGER_CLASS} .dsk-debug-event[open] summary { border-bottom: 1px solid var(--dsk-border); }
.${DEBUGGER_CLASS} .dsk-debug-event pre {
  max-height: 14rem;
  border: 0;
  border-radius: 0;
  background: var(--dsk-bg);
}
.${DEBUGGER_CLASS} .dsk-debug-divider {
  border-top: 1px solid var(--dsk-border);
}
.${DEBUGGER_CLASS} .dsk-debug-time {
  flex: 0 0 auto;
  color: var(--dsk-faint);
  font-variant-numeric: tabular-nums;
}
.${DEBUGGER_CLASS} .dsk-debug-source {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--dsk-muted);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${DEBUGGER_CLASS} .dsk-debug-empty {
  margin: 0;
  padding: 1.75rem 0.75rem;
  text-align: center;
  color: var(--dsk-faint);
}
.${DEBUGGER_CLASS} .dsk-debug-kind { flex: 0 0 auto; font-weight: 600; }
.${DEBUGGER_CLASS} .dsk-debug-kind[data-kind="signal"] { color: var(--dsk-add); }
.${DEBUGGER_CLASS} .dsk-debug-kind[data-kind="fetch"] { color: var(--dsk-blue); }
.${DEBUGGER_CLASS} .dsk-token-punct { color: var(--dsk-faint); }
.${DEBUGGER_CLASS} .dsk-token-key,
.${DEBUGGER_CLASS} .dsk-token-tag { color: var(--dsk-text); font-weight: 600; }
.${DEBUGGER_CLASS} .dsk-token-attr { color: #a7a7a7; }
.${DEBUGGER_CLASS} .dsk-token-string { color: #d8d19a; }
.${DEBUGGER_CLASS} .dsk-token-literal { color: #f0f0f0; }
.${DEBUGGER_CLASS} ::-webkit-scrollbar { width: 9px; height: 9px; }
.${DEBUGGER_CLASS} ::-webkit-scrollbar-thumb {
  background: #262626;
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.${DEBUGGER_CLASS} ::-webkit-scrollbar-thumb:hover { background: #383838; background-clip: padding-box; }
.${DEBUGGER_CLASS} ::-webkit-scrollbar-track { background: transparent; }
`

function assertStateName(stateName: string): asserts stateName is DatastarDebuggerStateName {
  if (!localStateNamePattern.test(stateName)) {
    throw new TypeError(
      `Datastar debugger stateName must be one underscore-prefixed signal name, received ${JSON.stringify(
        stateName
      )}`
    )
  }
}

const maxEventsValue = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_EVENTS

const rootClassName = (props: DatastarDebuggerProps): string =>
  [DEBUGGER_CLASS, props.class, props.className].filter(Boolean).join(" ")

export const datastarDebuggerDefaults = (): DatastarDebuggerState => ({
  tab: "signals",
  search: "",
  paused: false,
  events: []
})

const initialSignals = (stateName: DatastarDebuggerStateName): string =>
  JSON.stringify({ [stateName]: datastarDebuggerDefaults() })

const signalRef = (stateName: DatastarDebuggerStateName): string => `$${stateName}`

const stringifySource = `
const toDebugJson = (value) => {
  try {
    const json = JSON.stringify(value, null, 2)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}
`

const htmlEscapeSource = `
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
`

const syntaxHighlightSource = `
const highlightJson = (value) => toDebugJson(value).replace(
  /("(?:\\\\.|[^"\\\\])*")(\\s*:)?|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\btrue\\b|\\bfalse\\b|\\bnull\\b/g,
  (token, stringToken, keySuffix = "") => {
    if (stringToken) {
      const className = keySuffix ? "dsk-token-key" : "dsk-token-string"
      return '<span class="' + className + '">' + escapeHtml(stringToken) + '</span>' + escapeHtml(keySuffix)
    }
    return '<span class="dsk-token-literal">' + escapeHtml(token) + '</span>'
  }
)
const highlightAttrs = (text) => {
  let output = ""
  let lastIndex = 0
  text.replace(/([^\\s=]+)=("[^"]*"|'[^']*')/g, (match, name, value, index) => {
    output += escapeHtml(text.slice(lastIndex, index))
    output += '<span class="dsk-token-attr">' + escapeHtml(name) + '</span>'
    output += '<span class="dsk-token-punct">=</span>'
    output += '<span class="dsk-token-string">' + escapeHtml(value) + '</span>'
    lastIndex = index + match.length
    return match
  })
  return output + escapeHtml(text.slice(lastIndex))
}
const highlightHtmlLine = (line) => {
  const blockStart = line.match(/^(\\s*)<([A-Za-z][A-Za-z0-9:-]*)$/)
  if (blockStart) {
    return escapeHtml(blockStart[1]) + '<span class="dsk-token-punct">&lt;</span><span class="dsk-token-tag">' + escapeHtml(blockStart[2]) + '</span>'
  }
  const blockEnd = line.match(/^(\\s*)>$/)
  if (blockEnd) return escapeHtml(blockEnd[1]) + '<span class="dsk-token-punct">&gt;</span>'

  const attrLine = line.match(/^(\\s*)([^\\s=]+)=("[^"]*"|'[^']*')$/)
  if (attrLine) {
    return escapeHtml(attrLine[1])
      + '<span class="dsk-token-attr">' + escapeHtml(attrLine[2]) + '</span>'
      + '<span class="dsk-token-punct">=</span>'
      + '<span class="dsk-token-string">' + escapeHtml(attrLine[3]) + '</span>'
  }

  const tagLine = line.match(/^(\\s*)<(\\/?)([A-Za-z][A-Za-z0-9:-]*)([^>]*)>$/)
  if (!tagLine) return escapeHtml(line)

  return escapeHtml(tagLine[1])
    + '<span class="dsk-token-punct">&lt;' + escapeHtml(tagLine[2]) + '</span>'
    + '<span class="dsk-token-tag">' + escapeHtml(tagLine[3]) + '</span>'
    + highlightAttrs(tagLine[4])
    + '<span class="dsk-token-punct">&gt;</span>'
}
const highlightHtml = (html) => html.split("\\n").map(highlightHtmlLine).join("\\n")
`

const htmlFormatterSource = `
const formatHtml = (html) => {
  try {
    const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
    const template = document.createElement("template")
    template.innerHTML = html
    const lines = []
    const attrText = (attr) => {
      const quote = attr.value.includes('"') && !attr.value.includes("'") ? "'" : '"'
      const escaped = quote === '"'
        ? attr.value.replaceAll('"', "&quot;")
        : attr.value.replaceAll("'", "&#39;")
      return attr.name + "=" + quote + escaped + quote
    }
    const openLines = (element, indent) => {
      const tag = element.tagName.toLowerCase()
      const attrs = Array.from(element.attributes).map(attrText)
      const singleLine = "<" + tag + (attrs.length ? " " + attrs.join(" ") : "") + ">"
      if (singleLine.length <= 80) return [indent + singleLine]
      return [indent + "<" + tag, ...attrs.map((attr) => indent + "  " + attr), indent + ">"]
    }
    const walk = (node, depth = 0) => {
      const indent = "  ".repeat(depth)
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim()
        if (text) lines.push(indent + text)
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const tag = node.tagName.toLowerCase()
      const children = Array.from(node.childNodes)
      const opening = openLines(node, indent)
      if (voidTags.has(tag)) {
        lines.push(...opening)
        return
      }
      if (opening.length === 1 && children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
        const text = children[0].textContent.trim()
        const line = opening[0] + text + "</" + tag + ">"
        if (line.length <= 120) {
          lines.push(line)
          return
        }
      }

      lines.push(...opening)
      for (const child of children) walk(child, depth + 1)
      lines.push(indent + "</" + tag + ">")
    }

    for (const child of Array.from(template.content.childNodes)) walk(child)
    return lines.join("\\n") || html
  } catch {
    return html
  }
}
`

const matcherSource = (stateName: DatastarDebuggerStateName): string => `
const search = String(${signalRef(stateName)}.search || "").trim()
const createMatcher = () => {
  if (!search) return () => true

  const regex = search.match(/^\\/(.*)\\/([a-z]*)$/i)
  if (regex) {
    try {
      const flags = regex[2].replace(/[gy]/g, "")
      const matcher = new RegExp(regex[1], flags)
      return (value) => matcher.test(String(value))
    } catch {
      return () => false
    }
  }

  const lowered = search.toLowerCase()
  return (value) => String(value).toLowerCase().includes(lowered)
}
const matchesSearch = createMatcher()
`

const debugValueSource = `
const toElementLabel = (value) => {
  if (!value) return "document"
  return value.id ? "#" + value.id : "<" + String(value.tagName || "element").toLowerCase() + ">"
}
const toDebugValue = (value, seen = new WeakSet()) => {
  if (typeof value === "string") {
    return value.length > ${MAX_DEBUG_STRING_LENGTH}
      ? value.slice(0, ${MAX_DEBUG_STRING_LENGTH}) + "… truncated"
      : value
  }
  if (typeof value === "function") return "[Function]"
  if (typeof value === "bigint") return String(value) + "n"
  if (typeof Element !== "undefined" && value instanceof Element) return toElementLabel(value)
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    if (Array.isArray(value)) return value.map((item) => toDebugValue(item, seen))

    const output = {}
    for (const [key, item] of Object.entries(value)) output[key] = toDebugValue(item, seen)
    return output
  }
  return value
}
`

const patchTargetSource = `
const patchTargetLabel = (type, argsRaw) => {
  if (type !== "datastar-patch-elements") return undefined

  const selector = typeof argsRaw.selector === "string" ? argsRaw.selector.trim() : ""
  if (selector) return selector

  const elements = typeof argsRaw.elements === "string" ? argsRaw.elements : ""
  if (!elements) return undefined

  const template = document.createElement("template")
  template.innerHTML = elements
  const ids = Array.from(template.content.children)
    .map((element) => element.id ? "#" + element.id : "")
    .filter(Boolean)

  return ids.length > 0 ? ids.join(", ") : undefined
}
`

const signalSnapshotSource = (stateName: DatastarDebuggerStateName): string => `
const signalSnapshot = () => {
  const snapshot = {}
  for (const [key, value] of Object.entries($)) {
    if (key !== ${JSON.stringify(stateName)}) snapshot[key] = toDebugValue(value)
  }
  return snapshot
}
`

const rememberEventSource = (maxEvents: number): string => `
const rememberEvent = (event) => {
  debug.events.unshift(event)
  debug.events.length = Math.min(debug.events.length, ${maxEvents})
}
`

const signalPatchExpression = (stateName: DatastarDebuggerStateName, maxEvents: number): string => `
(() => {
  const debug = ${signalRef(stateName)}
  if (debug.paused) return

  ${debugValueSource}
  ${rememberEventSource(maxEvents)}

  rememberEvent({
    at: new Date().toLocaleTimeString(),
    kind: "signal",
    patch: toDebugValue(patch)
  })
})()
`

const fetchExpression = (stateName: DatastarDebuggerStateName, maxEvents: number): string => `
(() => {
  const debug = ${signalRef(stateName)}
  if (debug.paused) return

  ${debugValueSource}
  ${patchTargetSource}
  ${signalSnapshotSource(stateName)}
  ${rememberEventSource(maxEvents)}

  const detail = evt.detail || {}
  const type = detail.type || evt.type
  const argsRaw = detail.argsRaw || {}
  const target = patchTargetLabel(type, argsRaw)
  const entry = {
    at: new Date().toLocaleTimeString(),
    kind: "fetch",
    type,
    element: toElementLabel(detail.el),
    ...(target ? { target } : {}),
    argsRaw: toDebugValue(argsRaw)
  }

  if (entry.type === "started") entry.signals = signalSnapshot()
  rememberEvent(entry)
})()
`

const signalCountExpression = (stateName: DatastarDebuggerStateName): string =>
  `Object.keys($).filter((key) => key !== ${JSON.stringify(stateName)}).length + " signals"`

const signalsHtmlExpression = (stateName: DatastarDebuggerStateName): string => `
(() => {
  ${debugValueSource}
  ${signalSnapshotSource(stateName)}
  ${stringifySource}
  ${htmlEscapeSource}
  ${syntaxHighlightSource}
  ${matcherSource(stateName)}

  const snapshot = signalSnapshot()
  if (!search) {
    el.innerHTML = highlightJson(snapshot)
    return
  }

  const noMatch = Symbol("noMatch")
  const prunedValue = (value, path = "") => {
    if (matchesSearch(path)) return value
    if (value && typeof value === "object") {
      const output = Array.isArray(value) ? [] : {}
      let hasMatch = false

      for (const [key, item] of Object.entries(value)) {
        const childPath = path ? path + "." + key : key
        const child = prunedValue(item, childPath)
        if (child !== noMatch) {
          if (Array.isArray(output)) output.push(child)
          else output[key] = child
          hasMatch = true
        }
      }

      return hasMatch ? output : noMatch
    }

    return matchesSearch(path + " " + toDebugJson(value)) ? value : noMatch
  }

  const pruned = prunedValue(snapshot)
  el.innerHTML = pruned === noMatch ? "No signals match search." : highlightJson(pruned)
})()
`
const eventsHtmlExpression = (stateName: DatastarDebuggerStateName): string => `
(() => {
  ${stringifySource}
  ${matcherSource(stateName)}
  ${htmlEscapeSource}
  ${syntaxHighlightSource}
  ${htmlFormatterSource}

  const events = Array.from(${signalRef(stateName)}.events || [])
  const eventLabel = (event) => event.kind === "signal" ? "signal patch" : event.type
  const eventSource = (event) => event.kind !== "fetch" ? "" : event.target || event.element
  const eventText = (event) => {
    if (event.kind === "signal") return [event.at, eventLabel(event), toDebugJson(event.patch)].join(" ")
    return [event.at, event.type, event.element, event.target || "", toDebugJson(event.argsRaw), toDebugJson(event.signals || {})].join(" ")
  }
  const eventDetails = (event) => {
    const elements = event.kind === "fetch" && event.type === "datastar-patch-elements" && typeof event.argsRaw.elements === "string"
      ? event.argsRaw.elements
      : undefined
    if (!elements) return '<pre>' + highlightJson(event) + '</pre>'

    const eventWithoutElements = {
      ...event,
      argsRaw: { ...event.argsRaw, elements: "[formatted below]" }
    }
    return '<pre>' + highlightJson(eventWithoutElements) + '</pre>'
      + '<div class="dsk-debug-divider"></div>'
      + '<pre>' + highlightHtml(formatHtml(elements)) + '</pre>'
  }
  const renderEvent = (event) => [
    '<details class="dsk-debug-event">',
      '<summary>',
        '<span class="dsk-debug-time">', escapeHtml(event.at), '</span>',
        '<span class="dsk-debug-kind" data-kind="', escapeHtml(event.kind), '">', escapeHtml(eventLabel(event)), '</span>',
        event.kind === "fetch" ? '<span class="dsk-debug-source">' + escapeHtml(eventSource(event)) + '</span>' : '',
      '</summary>',
      eventDetails(event),
    '</details>'
  ].join("")

  const visibleEvents = search ? events.filter((event) => matchesSearch(eventText(event))) : events
  if (visibleEvents.length === 0) {
    const message = events.length === 0 ? "No debugger events yet." : "No events match search."
    el.innerHTML = '<p class="dsk-debug-empty">' + message + '</p>'
    return
  }

  el.innerHTML = visibleEvents.map(renderEvent).join("")
})()
`

const tabButton = ({
  stateName,
  tab,
  label
}: {
  readonly stateName: DatastarDebuggerStateName
  readonly tab: DatastarDebuggerTab
  readonly label: string
}): HtmlChild =>
  h(
    "button",
    {
      type: "button",
      role: "tab",
      "data-on:click": `${signalRef(stateName)}.tab = ${JSON.stringify(tab)}`,
      "data-attr:aria-selected": `${signalRef(stateName)}.tab === ${JSON.stringify(tab)}`
    },
    label
  )

const pill = (props: Record<string, string>, fallback: string): HtmlChild =>
  h("span", { class: "dsk-debug-pill", ...props }, fallback)

const icon = (props: Record<string, string>, ...paths: readonly HtmlChild[]): HtmlChild =>
  h(
    "svg",
    {
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      ...props
    },
    ...paths
  )

const pauseIcon = (stateName: DatastarDebuggerStateName): HtmlChild => [
  h(
    "span",
    { "data-show": `!${signalRef(stateName)}.paused`, style: "display:flex" },
    icon(
      {},
      h("rect", { x: "6", y: "5", width: "4", height: "14", rx: "1" }),
      h("rect", { x: "14", y: "5", width: "4", height: "14", rx: "1" })
    )
  ),
  h(
    "span",
    { "data-show": `${signalRef(stateName)}.paused`, style: "display:flex" },
    icon({}, h("path", { d: "M7 5l12 7-12 7z" }))
  )
]

const trashIcon = (): HtmlChild =>
  icon(
    {},
    h("path", { d: "M3 6h18" }),
    h("path", { d: "M8 6V4h8v2" }),
    h("path", { d: "M6 6l1 14h10l1-14" })
  )

const tabPanel = ({
  stateName,
  tab,
  title,
  children
}: {
  readonly stateName: DatastarDebuggerStateName
  readonly tab: DatastarDebuggerTab
  readonly title: string
  readonly children: HtmlChild
}): HtmlChild =>
  h(
    "section",
    {
      class: "dsk-debug-panel",
      role: "tabpanel",
      "data-show": `${signalRef(stateName)}.tab === ${JSON.stringify(tab)}`
    },
    h("h3", {}, title),
    children
  )

/**
 * Server-rendered Datastar debugger panel.
 *
 * Add this component to development pages after loading the Datastar runtime. It uses ordinary
 * Datastar signals and attributes, so no custom element registration or app-specific client bundle
 * is required.
 */
export const DatastarDebugger = (props: DatastarDebuggerProps = {}): HtmlChild => {
  const stateName = props.stateName ?? DATASTAR_DEBUGGER_STATE_NAME
  assertStateName(stateName)
  const maxEvents = maxEventsValue(props.maxEvents)

  return h(
    "section",
    {
      id: props.id ?? DEBUGGER_ID,
      class: rootClassName(props),
      style: props.style,
      "data-signals__ifmissing": initialSignals(stateName),
      "data-on-signal-patch-filter": `{exclude: /^${stateName}(\\.|$)/}`,
      "data-on-signal-patch": signalPatchExpression(stateName, maxEvents),
      "data-on:datastar-fetch": fetchExpression(stateName, maxEvents)
    },
    h("style", {}, debuggerStyles),
    h(
      "details",
      { open: props.open ?? true },
      h(
        "summary",
        {},
        h("span", { class: "dsk-debug-label" }, "Debug"),
        pill({ "data-text": signalCountExpression(stateName) }, "0 signals"),
        pill({ "data-text": `${signalRef(stateName)}.events.length + " events"` }, "0 events"),
        pill(
          {
            "data-kind": "warn",
            "data-show": `${signalRef(stateName)}.paused`
          },
          "paused"
        )
      ),
      h(
        "div",
        { class: "dsk-debug-body" },
        h(
          "div",
          { class: "dsk-debug-tabs", role: "tablist" },
          tabButton({ stateName, tab: "signals", label: "Signals" }),
          tabButton({ stateName, tab: "events", label: "Events" })
        ),
        h(
          "div",
          { class: "dsk-debug-controls" },
          h("input", {
            type: "search",
            placeholder: "Search or /regex/i",
            "aria-label": "Search debugger",
            "data-bind": `${stateName}.search`
          }),
          h(
            "button",
            {
              type: "button",
              "aria-label": "Pause debugger",
              "data-attr:aria-label": `${signalRef(stateName)}.paused ? "Resume debugger" : "Pause debugger"`,
              "data-attr:title": `${signalRef(stateName)}.paused ? "Resume" : "Pause"`,
              "data-on:click": `${signalRef(stateName)}.paused = !${signalRef(stateName)}.paused`,
              "data-attr:aria-pressed": `${signalRef(stateName)}.paused`
            },
            pauseIcon(stateName)
          ),
          h(
            "button",
            {
              type: "button",
              "aria-label": "Clear events",
              title: "Clear events",
              "data-on:click": `${signalRef(stateName)}.events = []`
            },
            trashIcon()
          )
        ),
        tabPanel({
          stateName,
          tab: "signals",
          title: "Signals",
          children: h("pre", { "data-effect": signalsHtmlExpression(stateName) }, "{}")
        }),
        tabPanel({
          stateName,
          tab: "events",
          title: "Events",
          children: h("div", {
            class: "dsk-debug-events",
            "data-effect": eventsHtmlExpression(stateName)
          })
        })
      )
    )
  )
}
