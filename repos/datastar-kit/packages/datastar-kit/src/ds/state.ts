import type { SignalState, SignalValue } from "../types.js"
import { assertSignalName, Signal, SignalNameError } from "./signals.js"

type SignalObject = SignalState

type IsUnion<T, Candidate = T> = [T] extends [never]
  ? false
  : T extends unknown
    ? [Candidate] extends [T]
      ? false
      : true
    : false

type WidenPrimitive<Value extends SignalValue, Primitive extends SignalValue> = [
  Primitive
] extends [Value]
  ? Primitive
  : IsUnion<Value> extends true
    ? Value
    : Primitive

type WidenSignalValue<Value extends SignalValue> = [Value] extends [string]
  ? WidenPrimitive<Value, string>
  : [Value] extends [number]
    ? WidenPrimitive<Value, number>
    : [Value] extends [boolean]
      ? WidenPrimitive<Value, boolean>
      : [Value] extends [null]
        ? null
        : [Value] extends [readonly (infer Item extends SignalValue)[]]
          ? readonly WidenSignalValue<Item>[]
          : [Value] extends [SignalObject]
            ? WidenSignalObject<Value>
            : Value

type WidenSignalObject<T extends SignalObject> = {
  readonly [Key in keyof T & string]: WidenSignalValue<T[Key]>
}

type SignalChildObject<Value extends SignalValue> = [Value] extends [readonly SignalValue[]]
  ? never
  : [Value] extends [SignalObject]
    ? Value
    : never

type SignalRefFor<Value extends SignalValue, Name extends string> = [Value] extends [
  readonly SignalValue[]
]
  ? Signal<Value, Name>
  : [Value] extends [SignalObject]
    ? StateSignalRefs<Value, Name>
    : Signal<Value, Name>

type StatePatchValue<Value extends SignalValue> = [Value] extends [readonly SignalValue[]]
  ? Value | null
  : [Value] extends [SignalObject]
    ? StatePatch<Value> | null
    : Value | null

/** Nested typed Datastar signal references for a `state(...)` object. */
export type StateSignalRefs<T extends SignalObject, Prefix extends string = ""> = {
  readonly [Key in keyof T & string]: SignalRefFor<
    T[Key],
    Prefix extends "" ? Key : `${Prefix}.${Key}`
  >
}

/** Type-checked partial signal patch accepted by a `state(...)` helper. */
export type StatePatch<T extends SignalObject> = {
  readonly [Key in keyof T & string]?: StatePatchValue<T[Key]>
}

/** Dot-separated paths available in a `state(...)` object. */
export type StateSignalPath<T extends SignalObject, Prefix extends string = ""> = {
  readonly [Key in keyof T & string]:
    | (Prefix extends "" ? Key : `${Prefix}.${Key}`)
    | (SignalChildObject<T[Key]> extends never
        ? never
        : StateSignalPath<SignalChildObject<T[Key]>, Prefix extends "" ? Key : `${Prefix}.${Key}`>)
}[keyof T & string]

/** Signal value stored at a dot-separated `state(...)` path. */
export type StateSignalPathValue<
  T extends SignalObject,
  Path extends string
> = Path extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T & string
    ? SignalChildObject<T[Key]> extends SignalObject
      ? StateSignalPathValue<SignalChildObject<T[Key]>, Rest>
      : never
    : never
  : Path extends keyof T & string
    ? T[Path]
    : never

/** A typed signal-state helper created by `state(...)`. */
export interface State<T extends SignalObject> {
  /** Initial signal values supplied to `state(...)`. */
  readonly defaults: T
  /** Nested typed leaf signal refs. */
  readonly refs: StateSignalRefs<T>
  /** Returns a typed signal ref for any state path, including object-valued paths. */
  ref<Path extends StateSignalPath<T>>(path: Path): Signal<StateSignalPathValue<T, Path>, Path>
  /** Returns a type-checked signal patch object for `event.signals(...)` or `reply.signals(...)`. */
  patch(values: StatePatch<T>): SignalState
  /** Returns the default state, optionally deep-merged with overrides. */
  reset(overrides?: StatePatch<T>): SignalState
}

const isSignalObject = (value: SignalValue): value is SignalObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const cloneSignalValue = (value: SignalValue): SignalValue => {
  if (Array.isArray(value)) {
    return value.map(cloneSignalValue)
  }

  if (isSignalObject(value)) {
    return cloneSignalState(value)
  }

  return value
}

const cloneSignalState = (value: SignalObject): SignalState => {
  const cloned: Record<string, SignalValue> = {}
  for (const [key, item] of Object.entries(value)) {
    cloned[key] = cloneSignalValue(item)
  }
  return cloned
}

const freezeSignalValue = (value: SignalValue): SignalValue => {
  if (Array.isArray(value)) {
    for (const item of value) freezeSignalValue(item)
    return Object.freeze(value)
  }

  if (isSignalObject(value)) {
    return freezeSignalState(value)
  }

  return value
}

const freezeSignalState = <T extends SignalObject>(value: T): T => {
  for (const item of Object.values(value)) {
    freezeSignalValue(item)
  }

  return Object.freeze(value)
}

const mergeSignalValue = (base: SignalValue | undefined, override: SignalValue): SignalValue => {
  if (base !== undefined && isSignalObject(base) && isSignalObject(override)) {
    return mergeSignalState(base, override)
  }

  return cloneSignalValue(override)
}

const mergeSignalState = (base: SignalObject, overrides: SignalObject): SignalState => {
  const merged: Record<string, SignalValue> = cloneSignalState(base)

  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = mergeSignalValue(base[key], value)
  }

  return merged
}

const assertStateKey = (key: string): void => {
  if (key.includes(".")) {
    throw new SignalNameError(key)
  }

  assertSignalName(key)
}

/** Error thrown when a `state(...)` path does not exist in the defaults object. */
export class StatePathError extends Error {
  constructor(readonly path: string) {
    super(`Unknown Datastar state path: ${JSON.stringify(path)}`)
  }
}

const assertStatePath = (state: SignalObject, path: string): void => {
  assertSignalName(path)

  let current: SignalValue = state
  for (const key of path.split(".")) {
    if (!isSignalObject(current) || !Object.hasOwn(current, key)) {
      throw new StatePathError(path)
    }

    current = current[key] as SignalValue
  }
}

const buildRefs = (value: SignalObject, prefix = ""): Record<string, unknown> => {
  const refs: Record<string, unknown> = {}

  for (const [key, item] of Object.entries(value)) {
    assertStateKey(key)
    const name = prefix.length === 0 ? key : `${prefix}.${key}`
    refs[key] = isSignalObject(item) ? buildRefs(item, name) : new Signal(name)
  }

  return refs
}

const refForStatePath = <T extends SignalObject, Path extends StateSignalPath<T>>(
  defaults: T,
  path: Path
): Signal<StateSignalPathValue<T, Path>, Path> => {
  assertStatePath(defaults, path)
  return new Signal(path) as Signal<StateSignalPathValue<T, Path>, Path>
}

/**
 * Creates a small typed helper around Datastar signal defaults.
 *
 * `state(...)` keeps initial values, signal refs, reset payloads, and partial signal patches
 * derived from one object. It does not read requests or perform schema validation.
 */
export const state = <T extends SignalObject>(defaults: T): State<WidenSignalObject<T>> => {
  const clonedDefaults = freezeSignalState(cloneSignalState(defaults)) as WidenSignalObject<T>
  const refs = buildRefs(clonedDefaults) as StateSignalRefs<WidenSignalObject<T>>

  return {
    defaults: clonedDefaults,
    refs,
    ref(path) {
      return refForStatePath(clonedDefaults, path)
    },
    patch(values) {
      return cloneSignalState(values as SignalObject)
    },
    reset(overrides) {
      return overrides === undefined
        ? cloneSignalState(clonedDefaults)
        : mergeSignalState(clonedDefaults, overrides as SignalObject)
    }
  }
}
