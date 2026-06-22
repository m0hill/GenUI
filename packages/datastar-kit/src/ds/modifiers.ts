/**
 * Structured timing options for Datastar debounce and throttle modifiers.
 */
export type TimingModifierOptions = Readonly<{
  duration: string | number
  leading?: boolean
  noTrailing?: boolean
  noLeading?: boolean
  trailing?: boolean
}>

/** @internal Supported Datastar key casing conversions used by the JSX modifier cleaner. */
export const datastarCaseModifiers = ["camel", "kebab", "snake", "pascal"] as const

/** Supported Datastar key casing conversions. */
export type CaseModifier = (typeof datastarCaseModifiers)[number]

/**
 * Modifier bag accepted by Datastar Kit's explicit modifier wrapper.
 *
 * The JSX runtime turns these options into Datastar's `__modifier` attribute-name suffixes.
 */
type DurationModifier = boolean | string | number
type TimingModifier = DurationModifier | TimingModifierOptions

export type DatastarModifierOptions = Readonly<{
  capture?: boolean
  case?: CaseModifier
  debounce?: TimingModifier
  delay?: DurationModifier
  document?: boolean
  duration?: DurationModifier
  event?: string | readonly string[]
  exit?: boolean
  full?: boolean
  half?: boolean
  ifMissing?: boolean
  leading?: boolean
  once?: boolean
  outside?: boolean
  passive?: boolean
  prevent?: boolean
  prop?: string
  self?: boolean
  stop?: boolean
  terse?: boolean
  threshold?: string | number
  throttle?: TimingModifier
  viewTransition?: boolean
  window?: boolean
}>

/** @internal */
export type DatastarModifierKey = keyof DatastarModifierOptions

type KnownModifierKeys<Modifiers> = Extract<keyof Modifiers, DatastarModifierKey>

type UnknownModifierMessage<Key extends PropertyKey> = Key extends string
  ? `Unknown Datastar modifier: ${Key}`
  : "Unknown Datastar modifier"

type NoUnknownModifierKeys<Modifiers extends DatastarModifierOptions> =
  Exclude<keyof Modifiers, DatastarModifierKey> extends never
    ? Modifiers
    : UnknownModifierMessage<Exclude<keyof Modifiers, DatastarModifierKey>>

const datastarModifiedValueBrand: unique symbol = Symbol("datastar-kit.modified-value")
const datastarModifiedModifierKeysBrand: unique symbol = Symbol(
  "datastar-kit.modified-modifier-keys"
)

/** A value plus Datastar modifiers that should be rendered onto the attribute name. */
export interface DatastarModifiedValue<
  Value = unknown,
  ModifierKeys extends DatastarModifierKey = DatastarModifierKey
> {
  readonly [datastarModifiedValueBrand]: true
  readonly [datastarModifiedModifierKeysBrand]: ModifierKeys | undefined
  readonly value: Value
  readonly modifiers: Readonly<DatastarModifierOptions>
}

const isModifierOptions = (value: unknown): value is DatastarModifierOptions =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const modifiedValue = <Value, Modifiers extends DatastarModifierOptions>(
  value: Value,
  modifiers: Modifiers
): DatastarModifiedValue<Value, KnownModifierKeys<Modifiers>> => {
  const modified: DatastarModifiedValue<Value, KnownModifierKeys<Modifiers>> = {
    [datastarModifiedValueBrand]: true,
    [datastarModifiedModifierKeysBrand]: undefined,
    value,
    modifiers: Object.freeze({ ...modifiers })
  }
  return Object.freeze(modified)
}

/**
 * Wraps an attribute value with Datastar modifiers.
 *
 * Use `mod(value, modifiers)` for normal value-bearing Datastar attributes. Use the one-argument
 * form only for presence attributes whose raw Datastar form has no value, such as
 * `data-ignore__self`.
 *
 * @example
 * ```tsx
 * <form data-on:submit={mod(post("/signup"), { prevent: true })} />
 * <input data-on:input={mod(get("/search"), { debounce: "200ms" })} />
 * <div data-ignore={mod({ self: true })} />
 * ```
 */
export function mod<const Modifiers extends DatastarModifierOptions>(
  modifiers: NoUnknownModifierKeys<Modifiers>
): DatastarModifiedValue<true, KnownModifierKeys<Modifiers>>
export function mod<const Value, const Modifiers extends DatastarModifierOptions>(
  value: Value,
  modifiers: NoUnknownModifierKeys<Modifiers>
): DatastarModifiedValue<Value, KnownModifierKeys<Modifiers>>
export function mod<const Value>(
  valueOrModifiers: Value,
  modifiers?: unknown
): DatastarModifiedValue<Value | true> {
  if (modifiers !== undefined) {
    if (!isModifierOptions(modifiers)) {
      throw new TypeError("Datastar modifiers must be an object")
    }
    return modifiedValue(valueOrModifiers, modifiers)
  }

  if (!isModifierOptions(valueOrModifiers)) {
    throw new TypeError("Datastar modifiers must be an object")
  }

  return modifiedValue(true, valueOrModifiers)
}

/** @internal */
export const isDatastarModifiedValue = (value: unknown): value is DatastarModifiedValue =>
  typeof value === "object" &&
  value !== null &&
  datastarModifiedValueBrand in value &&
  value[datastarModifiedValueBrand] === true
