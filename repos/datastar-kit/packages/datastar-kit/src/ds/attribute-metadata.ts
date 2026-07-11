type AttributeRule = {
  readonly exact?: readonly string[]
  readonly prefixes?: readonly string[]
}

export type DatastarModifierTarget =
  | "bind"
  | "bindKey"
  | "case"
  | "computed"
  | "ignore"
  | "init"
  | "intersect"
  | "interval"
  | "jsonSignals"
  | "on"
  | "signalPatch"
  | "signals"
  | "signalsKey"

const matches = (name: string, rule: AttributeRule): boolean =>
  (rule.exact?.includes(name) ?? false) ||
  (rule.prefixes?.some((prefix) => name.startsWith(prefix)) ?? false)

export const datastarAttributeRoot = (name: string): string => name.split("__", 1)[0] ?? name

export const isDatastarAttribute = (name: string): boolean => name.startsWith("data-")

const presenceAttributes = {
  exact: [
    "data-bind",
    "data-ignore",
    "data-ignore-morph",
    "data-indicator",
    "data-json-signals",
    "data-persist",
    "data-query-string",
    "data-ref",
    "data-scope-children",
    "data-scroll-into-view"
  ],
  prefixes: ["data-bind:", "data-indicator:", "data-persist:", "data-ref:", "data-signals:"]
} as const satisfies AttributeRule

export const isDatastarPresenceAttribute = (name: string): boolean =>
  matches(datastarAttributeRoot(name), presenceAttributes)

const modifierTargets = [
  { target: "bind", exact: ["data-bind"] },
  { target: "bindKey", prefixes: ["data-bind:"] },
  {
    target: "case",
    prefixes: ["data-ref:", "data-indicator:", "data-class:"]
  },
  { target: "computed", prefixes: ["data-computed:"] },
  { target: "ignore", exact: ["data-ignore"] },
  { target: "init", exact: ["data-init"] },
  { target: "intersect", exact: ["data-on-intersect"] },
  { target: "interval", exact: ["data-on-interval"] },
  { target: "jsonSignals", exact: ["data-json-signals"] },
  { target: "signalPatch", exact: ["data-on-signal-patch"] },
  { target: "on", prefixes: ["data-on:"] },
  { target: "signals", exact: ["data-signals"] },
  { target: "signalsKey", prefixes: ["data-signals:"] }
] as const satisfies readonly (AttributeRule & { readonly target: DatastarModifierTarget })[]

export const datastarModifierTarget = (name: string): DatastarModifierTarget | undefined => {
  const root = datastarAttributeRoot(name)
  return modifierTargets.find((rule) => matches(root, rule))?.target
}

const expressionAttributes = {
  exact: [
    "data-signals",
    "data-computed",
    "data-attr",
    "data-class",
    "data-style",
    "data-init",
    "data-effect",
    "data-text",
    "data-show",
    "data-on-intersect",
    "data-on-interval",
    "data-on-signal-patch"
  ],
  prefixes: [
    "data-signals:",
    "data-computed:",
    "data-attr:",
    "data-class:",
    "data-style:",
    "data-on:"
  ]
} as const satisfies AttributeRule

export const isDatastarExpressionAttribute = (name: string): boolean =>
  matches(datastarAttributeRoot(name), expressionAttributes)

const signalNameAttributes = new Set(["data-bind", "data-ref", "data-indicator"])

export const isDatastarSignalNameAttribute = (name: string): boolean =>
  signalNameAttributes.has(datastarAttributeRoot(name))
