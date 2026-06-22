import type { DatastarModifierTarget } from "./attribute-metadata.js"
import { isExpr } from "./expression.js"
import { datastarCaseModifiers, type DatastarModifierKey } from "./modifiers.js"

interface RenderedDatastarModifier {
  readonly key: DatastarModifierKey
  readonly suffix: string
}

const compatibleModifierTargets = {
  capture: ["on"],
  case: ["bindKey", "case", "computed", "on", "signalsKey"],
  debounce: ["on", "intersect", "signalPatch"],
  delay: ["on", "intersect", "signalPatch", "init"],
  document: ["on"],
  duration: ["interval"],
  event: ["bind", "bindKey"],
  exit: ["intersect"],
  full: ["intersect"],
  half: ["intersect"],
  ifMissing: ["signals", "signalsKey"],
  leading: ["interval"],
  once: ["on", "intersect"],
  outside: ["on"],
  passive: ["on"],
  prevent: ["on"],
  prop: ["bind", "bindKey"],
  self: ["ignore"],
  stop: ["on"],
  terse: ["jsonSignals"],
  threshold: ["intersect"],
  throttle: ["on", "intersect", "signalPatch"],
  viewTransition: ["on", "intersect", "init", "interval"],
  window: ["on"]
} as const satisfies Record<DatastarModifierKey, readonly DatastarModifierTarget[]>

/**
 * Modifier keys accepted by one Datastar attribute modifier target.
 *
 * @internal
 */
export type DatastarModifierKeysFor<Target extends DatastarModifierTarget> = {
  [Key in DatastarModifierKey]: Target extends (typeof compatibleModifierTargets)[Key][number]
    ? Key
    : never
}[DatastarModifierKey]

const caseModifiers = new Set<string>(datastarCaseModifiers)

const isDatastarModifierKey = (key: string): key is DatastarModifierKey =>
  key in compatibleModifierTargets

const isCompatibleModifier = (
  target: DatastarModifierTarget,
  modifier: RenderedDatastarModifier
): boolean => {
  const targets: readonly DatastarModifierTarget[] = compatibleModifierTargets[modifier.key]
  return targets.includes(target)
}

const durationModifier = (value: unknown): string => {
  if (typeof value === "number") return `${value}ms`
  if (typeof value === "string") return /^\d+$/.test(value) ? `${value}ms` : value
  throw new TypeError(`Unsupported Datastar duration modifier value: ${JSON.stringify(value)}`)
}

const isModifierRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !isExpr(value)

const flagModifier = (
  key: DatastarModifierKey,
  value: unknown,
  suffix: string
): RenderedDatastarModifier | undefined => {
  if (value === false || value === null || value === undefined) return undefined
  if (value === true) return { key, suffix }
  throw new TypeError(`Datastar modifier ${JSON.stringify(key)} expects a boolean value`)
}

const durationTaggedModifier = (
  key: DatastarModifierKey,
  value: unknown,
  modifier: string
): RenderedDatastarModifier | undefined => {
  if (value === false || value === null || value === undefined) return undefined
  if (value === true) return { key, suffix: modifier }
  return { key, suffix: `${modifier}.${durationModifier(value)}` }
}

const timingTaggedModifier = (
  key: DatastarModifierKey,
  value: unknown,
  modifier: "debounce" | "throttle"
): RenderedDatastarModifier | undefined => {
  if (value === false || value === null || value === undefined) return undefined
  if (value === true) return { key, suffix: modifier }

  if (!isModifierRecord(value)) {
    return { key, suffix: `${modifier}.${durationModifier(value)}` }
  }

  const duration = value.duration
  if (duration === undefined) {
    throw new TypeError(`Datastar modifier ${JSON.stringify(key)} requires a duration`)
  }

  const parts = [durationModifier(duration)]
  if (modifier === "debounce") {
    if (value.leading === true) parts.push("leading")
    if (value.noTrailing === true) parts.push("notrailing")
  } else {
    if (value.noLeading === true) parts.push("noleading")
    if (value.trailing === true) parts.push("trailing")
  }
  return { key, suffix: `${modifier}.${parts.join(".")}` }
}

const valueTaggedModifier = (
  key: DatastarModifierKey,
  value: unknown,
  modifier: string,
  allowed?: ReadonlySet<string>
): RenderedDatastarModifier | undefined => {
  if (value === false || value === null || value === undefined) return undefined
  if (typeof value === "string" || typeof value === "number") {
    if (allowed !== undefined && !allowed.has(String(value))) {
      throw new TypeError(`Datastar modifier ${JSON.stringify(key)} received unsupported value`)
    }
    return { key, suffix: `${modifier}.${value}` }
  }
  throw new TypeError(`Datastar modifier ${JSON.stringify(key)} expects a string or number value`)
}

const eventModifier = (value: unknown): string => {
  const events = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined
  if (events === undefined || events.some((event) => typeof event !== "string")) {
    throw new TypeError('Datastar modifier "event" expects a string or string array')
  }
  return `event.${events.join(".")}`
}

const renderDatastarModifier = (
  key: string,
  value: unknown
): RenderedDatastarModifier | undefined => {
  if (!isDatastarModifierKey(key)) {
    throw new TypeError(`Unknown Datastar modifier ${JSON.stringify(key)}`)
  }

  switch (key) {
    case "capture":
    case "document":
    case "exit":
    case "full":
    case "half":
    case "leading":
    case "once":
    case "outside":
    case "passive":
    case "prevent":
    case "stop":
    case "window":
      return flagModifier(key, value, key)
    case "self":
      return flagModifier(key, value, "self")
    case "ifMissing":
      return flagModifier(key, value, "ifmissing")
    case "terse":
      return flagModifier(key, value, "terse")
    case "viewTransition":
      return flagModifier(key, value, "viewtransition")
    case "delay":
      return durationTaggedModifier(key, value, "delay")
    case "duration":
      return durationTaggedModifier(key, value, "duration")
    case "debounce":
      return timingTaggedModifier(key, value, "debounce")
    case "throttle":
      return timingTaggedModifier(key, value, "throttle")
    case "case":
      return valueTaggedModifier(key, value, key, caseModifiers)
    case "prop":
    case "threshold":
      return valueTaggedModifier(key, value, key)
    case "event":
      if (value === false || value === null || value === undefined) return undefined
      return { key, suffix: eventModifier(value) }
  }

  const exhaustive: never = key
  return exhaustive
}

const intervalDurationModifier = (
  duration: unknown,
  leading: unknown,
  hasDuration: boolean
): RenderedDatastarModifier | undefined => {
  const durationEnabled = duration !== false && duration !== null && duration !== undefined
  const leadingEnabled = leading === true

  if (leading !== false && leading !== null && leading !== undefined && leading !== true) {
    throw new TypeError('Datastar modifier "leading" expects a boolean value')
  }

  if (!durationEnabled && !leadingEnabled) return undefined

  const parts: string[] = []
  if (hasDuration && duration !== true) {
    parts.push(durationModifier(duration))
  }
  if (leadingEnabled) {
    parts.push("leading")
  }

  return {
    key: "duration",
    suffix: parts.length === 0 ? "duration" : `duration.${parts.join(".")}`
  }
}

export const renderDatastarModifierSuffixes = (
  target: DatastarModifierTarget,
  name: string,
  modifiers: Readonly<Record<string, unknown>>
): string[] => {
  const suffixes: string[] = []
  let intervalDuration: unknown
  let intervalLeading: unknown
  let hasIntervalDuration = false

  for (const [key, modifierValue] of Object.entries(modifiers)) {
    if (target === "interval" && key === "duration") {
      intervalDuration = modifierValue
      hasIntervalDuration = true
      continue
    }
    if (target === "interval" && key === "leading") {
      intervalLeading = modifierValue
      continue
    }

    const modifier = renderDatastarModifier(key, modifierValue)
    if (modifier === undefined) continue
    if (!isCompatibleModifier(target, modifier)) {
      throw new TypeError(
        `Datastar modifier ${JSON.stringify(key)} is not valid on ${JSON.stringify(name)}`
      )
    }
    suffixes.push(modifier.suffix)
  }

  if (target === "interval") {
    const duration = intervalDurationModifier(
      intervalDuration,
      intervalLeading,
      hasIntervalDuration
    )
    if (duration !== undefined) suffixes.unshift(duration.suffix)
  }

  return suffixes
}
