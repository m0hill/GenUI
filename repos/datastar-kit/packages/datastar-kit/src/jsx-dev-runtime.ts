import type { HtmlElements } from "./html-attributes.js"
import type { HtmlChild } from "./html.js"
import { Fragment, jsx } from "./jsx-runtime.js"
import type { JsxProps, JsxTag } from "./jsx.js"

/**
 * Compiler-only JSX fragment export for the automatic development JSX runtime.
 *
 * @internal
 */
export { Fragment }

/**
 * Compiler-only entrypoint for TypeScript's automatic development JSX runtime.
 *
 * @internal
 * @param tag Intrinsic tag, fragment marker, or function component.
 * @param input Props supplied by the JSX transform.
 * @param key JSX key consumed by the compiler/runtime boundary.
 * @param _isStaticChildren Development-runtime static children flag.
 * @param _source Development-runtime source metadata.
 * @param _self Development-runtime receiver metadata.
 * @returns A Datastar Kit HTML node or fragment.
 */
export const jsxDEV = (
  tag: JsxTag,
  input:
    | (Readonly<Record<string, unknown>> & { readonly children?: HtmlChild | readonly HtmlChild[] })
    | null,
  key?: string | number,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown
): HtmlChild => jsx(tag, input, key)

/**
 * TypeScript JSX namespace for `jsxImportSource: "datastar-kit"` in development builds.
 *
 * @internal
 */
export namespace JSX {
  /** Renderable JSX element type. */
  export type Element = HtmlChild
  /** Tells TypeScript that JSX children are passed through a `children` prop. */
  export interface ElementChildrenAttribute {
    children: {}
  }
  /** Compiler-managed attributes accepted by all JSX elements. */
  export interface IntrinsicAttributes {
    key?: string | number
  }
  /**
   * Intrinsic HTML element props accepted by this runtime.
   *
   * Known HTML and SVG tags get typed attributes and editor autocomplete; any other tag (custom
   * elements included) is accepted with loosely typed props as an escape hatch.
   */
  export type IntrinsicElements = HtmlElements & {
    [tagName: string]: JsxProps
  }
}
