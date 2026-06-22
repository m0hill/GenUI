/**
 * Any pure JSON-serializable value that can live in a Datastar signal.
 */
export type SignalValue =
  | string
  | number
  | boolean
  | null
  | readonly SignalValue[]
  | { readonly [key: string]: SignalValue }

/**
 * A strict runtime object tree of Datastar signal values.
 * Represents pure client-side state without authoring expressions.
 */
export type SignalState = Readonly<Record<string, SignalValue>>
