import type { HtmlPropValue } from "../html.js"
import type { Expr } from "./expression.js"
import type { DatastarModifierKeysFor } from "./modifier-rendering.js"
import type { DatastarModifiedValue, DatastarModifierKey } from "./modifiers.js"
import type { SignalStateInput, SignalValueInput } from "./signals.js"

/**
 * Datastar expression source accepted by expression-valued attributes: a typed expression built
 * with helpers such as `js`, `get`, or `signal`, or a raw expression string.
 */
export type DatastarExpression = Expr | string

/**
 * Expression input that also accepts JSON literals, which are serialized into expression source.
 */
export type DatastarExpressionValue = Expr | string | number | boolean | null

/**
 * An attribute value optionally wrapped with `mod(value, modifiers)`, restricted to the modifier
 * keys the attribute accepts.
 */
export type DatastarModifiable<Value, Keys extends DatastarModifierKey = DatastarModifierKey> =
  | Value
  | DatastarModifiedValue<Value, Keys>

type DatastarBindModifierKey = DatastarModifierKeysFor<"bind">
type DatastarBindKeyModifierKey = DatastarModifierKeysFor<"bindKey">
type DatastarCaseModifierKey = DatastarModifierKeysFor<"case">
type DatastarComputedModifierKey = DatastarModifierKeysFor<"computed">
type DatastarIgnoreModifierKey = DatastarModifierKeysFor<"ignore">
type DatastarInitModifierKey = DatastarModifierKeysFor<"init">
type DatastarIntersectModifierKey = DatastarModifierKeysFor<"intersect">
type DatastarIntervalModifierKey = DatastarModifierKeysFor<"interval">
type DatastarJsonSignalsModifierKey = DatastarModifierKeysFor<"jsonSignals">
type DatastarOnModifierKey = DatastarModifierKeysFor<"on">
type DatastarSignalPatchModifierKey = DatastarModifierKeysFor<"signalPatch">
type DatastarSignalsModifierKey = DatastarModifierKeysFor<"signals">
type DatastarSignalsKeyModifierKey = DatastarModifierKeysFor<"signalsKey">

/**
 * Value accepted by presence-style Datastar attributes such as `data-ignore`.
 *
 * `true` renders the bare attribute, `false`, `null`, and `undefined` omit it, and strings are
 * kept raw for hand-authored values.
 */
export type DatastarPresenceValue = string | boolean | null

/**
 * Nested object of Datastar expressions accepted by `data-computed`.
 */
export type DatastarComputedInput =
  | DatastarExpression
  | { readonly [key: string]: DatastarComputedInput }

/**
 * A typed signal reference (or raw signal-name string) accepted by signal-name attributes such as
 * `data-bind`, `data-ref`, and `data-indicator`.
 */
export interface DatastarSignalReference {
  /** Dotted signal path rendered as the attribute value. */
  readonly name: string
  /** Serializes this reference as Datastar expression source. */
  toDatastarExpression(): string
}

/**
 * Signal filter accepted by filter-valued Datastar attributes such as `data-json-signals` and
 * `data-on-signal-patch-filter`.
 */
export type DatastarSignalFilterInput = {
  /** Regular expression or expression selecting signal paths to include. */
  readonly include?: Expr<RegExp> | RegExp | string | undefined
  /** Regular expression or expression selecting signal paths to exclude. */
  readonly exclude?: Expr<RegExp> | RegExp | string | undefined
}

/**
 * Escape-hatch value union accepted by arbitrary `data-*` attributes.
 *
 * Known Datastar attributes are typed precisely; everything else under `data-` accepts any value
 * the JSX runtime can serialize.
 */
export type DatastarAttributeValue =
  | HtmlPropValue
  | Expr
  | DatastarModifiedValue
  | RegExp
  | readonly DatastarAttributeValue[]
  | { readonly [key: string]: DatastarAttributeValue }

/**
 * DOM event names suggested for `data-on:` attributes.
 *
 * Any other event name (custom events included) is still accepted through the `data-on:` template
 * attribute signature.
 */
export type DatastarEventName =
  | "abort"
  | "animationcancel"
  | "animationend"
  | "animationiteration"
  | "animationstart"
  | "auxclick"
  | "beforeinput"
  | "beforetoggle"
  | "blur"
  | "cancel"
  | "canplay"
  | "canplaythrough"
  | "change"
  | "click"
  | "close"
  | "compositionend"
  | "compositionstart"
  | "compositionupdate"
  | "contextmenu"
  | "copy"
  | "cut"
  | "datastar-fetch"
  | "dblclick"
  | "drag"
  | "dragend"
  | "dragenter"
  | "dragleave"
  | "dragover"
  | "dragstart"
  | "drop"
  | "durationchange"
  | "emptied"
  | "ended"
  | "error"
  | "focus"
  | "focusin"
  | "focusout"
  | "input"
  | "invalid"
  | "keydown"
  | "keypress"
  | "keyup"
  | "load"
  | "loadeddata"
  | "loadedmetadata"
  | "loadstart"
  | "mousedown"
  | "mouseenter"
  | "mouseleave"
  | "mousemove"
  | "mouseout"
  | "mouseover"
  | "mouseup"
  | "paste"
  | "pause"
  | "play"
  | "playing"
  | "pointercancel"
  | "pointerdown"
  | "pointerenter"
  | "pointerleave"
  | "pointermove"
  | "pointerout"
  | "pointerover"
  | "pointerup"
  | "progress"
  | "ratechange"
  | "reset"
  | "resize"
  | "scroll"
  | "scrollend"
  | "seeked"
  | "seeking"
  | "select"
  | "selectionchange"
  | "slotchange"
  | "stalled"
  | "submit"
  | "suspend"
  | "timeupdate"
  | "toggle"
  | "touchcancel"
  | "touchend"
  | "touchmove"
  | "touchstart"
  | "transitioncancel"
  | "transitionend"
  | "transitionrun"
  | "transitionstart"
  | "volumechange"
  | "waiting"
  | "wheel"

/**
 * Named `data-on:` attributes generated from {@link DatastarEventName} so common events appear in
 * editor autocomplete.
 */
export type DatastarEventAttributes = {
  [Event in DatastarEventName as `data-on:${Event}`]?:
    | DatastarModifiable<DatastarExpressionValue, DatastarOnModifierKey>
    | undefined
}

/**
 * Datastar attributes accepted by every intrinsic JSX element.
 *
 * Exact attributes are typed with their precise value shapes; keyed attributes (`data-on:*`,
 * `data-signals:*`, ...) are typed through template signatures, and unrecognized `data-*`
 * attributes fall back to {@link DatastarAttributeValue} as an escape hatch.
 *
 * @see https://data-star.dev/reference/attributes
 */
export interface DatastarAttributes extends DatastarEventAttributes {
  /** Sets attributes from an object of attribute names to expressions. @see https://data-star.dev/reference/attributes#data-attr */
  "data-attr"?: Readonly<Record<string, DatastarExpressionValue>> | DatastarExpression | undefined
  /** Two-way binds an element value to a signal. @see https://data-star.dev/reference/attributes#data-bind */
  "data-bind"?:
    | DatastarModifiable<DatastarSignalReference | string, DatastarBindModifierKey>
    | null
    | undefined
  /** Toggles classes from an object of class names to boolean expressions. @see https://data-star.dev/reference/attributes#data-class */
  "data-class"?: Readonly<Record<string, Expr | string | boolean>> | DatastarExpression | undefined
  /** Creates read-only computed signals. @see https://data-star.dev/reference/attributes#data-computed */
  "data-computed"?: DatastarComputedInput | undefined
  /** Runs an expression whenever its signal dependencies change. @see https://data-star.dev/reference/attributes#data-effect */
  "data-effect"?: DatastarExpressionValue | undefined
  /** Skips Datastar processing for this element and its descendants. @see https://data-star.dev/reference/attributes#data-ignore */
  "data-ignore"?: DatastarModifiable<DatastarPresenceValue, DatastarIgnoreModifierKey> | undefined
  /** Preserves this element when morphing. @see https://data-star.dev/reference/attributes#data-ignore-morph */
  "data-ignore-morph"?: DatastarPresenceValue | undefined
  /** Tracks in-flight fetch requests in a boolean signal. @see https://data-star.dev/reference/attributes#data-indicator */
  "data-indicator"?: DatastarSignalReference | string | null | undefined
  /** Runs an expression when the element is initialized. @see https://data-star.dev/reference/attributes#data-init */
  "data-init"?: DatastarModifiable<DatastarExpressionValue, DatastarInitModifierKey> | undefined
  /** Renders matching signals as JSON text content. @see https://data-star.dev/reference/attributes#data-json-signals */
  "data-json-signals"?:
    | DatastarModifiable<
        boolean | null | DatastarSignalFilterInput | DatastarExpression,
        DatastarJsonSignalsModifierKey
      >
    | undefined
  /** Runs an expression when the element intersects the viewport. @see https://data-star.dev/reference/attributes#data-on-intersect */
  "data-on-intersect"?:
    | DatastarModifiable<DatastarExpressionValue, DatastarIntersectModifierKey>
    | undefined
  /** Runs an expression on a timed interval. @see https://data-star.dev/reference/attributes#data-on-interval */
  "data-on-interval"?:
    | DatastarModifiable<DatastarExpressionValue, DatastarIntervalModifierKey>
    | undefined
  /** Runs an expression when signals are patched. @see https://data-star.dev/reference/attributes#data-on-signal-patch */
  "data-on-signal-patch"?:
    | DatastarModifiable<DatastarExpressionValue, DatastarSignalPatchModifierKey>
    | undefined
  /** Filters which signal patches trigger `data-on-signal-patch`. @see https://data-star.dev/reference/attributes#data-on-signal-patch-filter */
  "data-on-signal-patch-filter"?: DatastarSignalFilterInput | DatastarExpression | null | undefined
  /** Persists matching signals in web storage. @see https://data-star.dev/reference/attributes#data-persist */
  "data-persist"?: boolean | null | DatastarSignalFilterInput | DatastarExpression | undefined
  /** Preserves listed attribute values when morphing. @see https://data-star.dev/reference/attributes#data-preserve-attr */
  "data-preserve-attr"?: string | null | undefined
  /** Syncs matching signals with the URL query string. @see https://data-star.dev/reference/attributes#data-query-string */
  "data-query-string"?: boolean | null | DatastarSignalFilterInput | DatastarExpression | undefined
  /** Stores a reference to this element in a signal. @see https://data-star.dev/reference/attributes#data-ref */
  "data-ref"?: DatastarSignalReference | string | null | undefined
  /** Scopes signals to this element's descendants. @see https://data-star.dev/reference/attributes#data-scope-children */
  "data-scope-children"?: DatastarPresenceValue | undefined
  /** Scrolls the element into view. @see https://data-star.dev/reference/attributes#data-scroll-into-view */
  "data-scroll-into-view"?: DatastarPresenceValue | undefined
  /** Shows or hides the element based on a boolean expression. @see https://data-star.dev/reference/attributes#data-show */
  "data-show"?: DatastarExpressionValue | undefined
  /** Patches signals from an object of signal defaults. @see https://data-star.dev/reference/attributes#data-signals */
  "data-signals"?:
    | DatastarModifiable<SignalStateInput | DatastarExpression, DatastarSignalsModifierKey>
    | undefined
  /** Sets inline styles from an object of style properties to expressions. @see https://data-star.dev/reference/attributes#data-style */
  "data-style"?: Readonly<Record<string, DatastarExpressionValue>> | DatastarExpression | undefined
  /** Sets text content from an expression. @see https://data-star.dev/reference/attributes#data-text */
  "data-text"?: DatastarExpressionValue | undefined

  /** Sets a single attribute from an expression, e.g. `data-attr:disabled`. */
  [name: `data-attr:${string}`]: DatastarExpressionValue | undefined
  /** Two-way binds an element value to the signal named by the attribute key, e.g. `data-bind:value`. */
  [name: `data-bind:${string}`]:
    | DatastarModifiable<boolean | null, DatastarBindKeyModifierKey>
    | undefined
  /** Toggles a single class from a boolean expression, e.g. `data-class:hidden`. */
  [name: `data-class:${string}`]:
    | DatastarModifiable<DatastarExpressionValue, DatastarCaseModifierKey>
    | undefined
  /** Creates a read-only computed signal named by the attribute key. */
  [name: `data-computed:${string}`]:
    | DatastarModifiable<DatastarExpressionValue, DatastarComputedModifierKey>
    | undefined
  /** Tracks in-flight fetch requests in the signal named by the attribute key. */
  [name: `data-indicator:${string}`]:
    | DatastarModifiable<boolean | null, DatastarCaseModifierKey>
    | undefined
  /** Runs an expression when the named event fires, e.g. `data-on:click`. */
  [name: `data-on:${string}`]:
    | DatastarModifiable<DatastarExpressionValue, DatastarOnModifierKey>
    | undefined
  /** Persists matching signals under the storage key named by the attribute key. */
  [name: `data-persist:${string}`]: boolean | null | DatastarSignalFilterInput | undefined
  /** Stores a reference to this element in the signal named by the attribute key. */
  [name: `data-ref:${string}`]:
    | DatastarModifiable<boolean | null, DatastarCaseModifierKey>
    | undefined
  /** Patches the signal named by the attribute key, e.g. `data-signals:count`. */
  [name: `data-signals:${string}`]:
    | DatastarModifiable<SignalValueInput, DatastarSignalsKeyModifierKey>
    | undefined
  /** Sets a single style property from an expression, e.g. `data-style:opacity`. */
  [name: `data-style:${string}`]: DatastarExpressionValue | undefined
  /** Escape hatch: any other `data-*` attribute accepts any serializable value. */
  [name: `data-${string}`]: DatastarAttributeValue
}
