import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-text", () => {
  it("renders text expressions with the hyperscript factory", () => {
    const node = h("div", { "data-text": "$foo" })

    expect(renderToString(node)).toBe('<div data-text="$foo"></div>')
  })

  it("renders JSX values from signal refs and expression helpers", () => {
    const foo = signal<string>("foo")

    const node = (
      <div>
        <span data-text={foo}></span>
        <span data-text={js`${foo} + ${"!"}`}></span>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><span data-text="$foo"></span><span data-text="$foo + &quot;!&quot;"></span></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-text="$foo"></div>

    expect(renderToString(node)).toBe('<div data-text="$foo"></div>')
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="bar"
        data-text="$foo + el.id"
      ></div>
    )

    expect(renderToString(node)).toBe('<div id="bar" data-text="$foo + el.id"></div>')
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <span data-text></span>
        <span data-text={false}></span>
        <span data-text={0}></span>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><span data-text="true"></span><span data-text="false"></span><span data-text="0"></span></div>'
    )
  })

  it("escapes fallback child content independently from the data-text expression", () => {
    const node = <span data-text="$foo">Fallback &lt;safe&gt;</span>

    expect(renderToString(node)).toBe('<span data-text="$foo">Fallback &lt;safe&gt;</span>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:foo="'hello'"
        data-text="$foo"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:foo="&#39;hello&#39;" data-text="$foo"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-text has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-text": mod(signal<string>("foo"), { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-text" does not accept modifiers')
  })
})
