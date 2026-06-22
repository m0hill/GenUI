import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-show", () => {
  it("renders show expressions with the hyperscript factory", () => {
    const node = h("div", { "data-show": "$foo" })

    expect(renderToString(node)).toBe('<div data-show="$foo"></div>')
  })

  it("renders JSX values from signal refs and expression helpers", () => {
    const foo = signal<boolean>("foo")

    const node = (
      <div>
        <div data-show={foo}></div>
        <div data-show={js`${foo} && el.dataset.ready === ${"yes"}`}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-show="$foo"></div><div data-show="$foo &amp;&amp; el.dataset.ready === &quot;yes&quot;"></div></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-show="$foo"></div>

    expect(renderToString(node)).toBe('<div data-show="$foo"></div>')
  })

  it("renders initial anti-flicker style with data-show", () => {
    const node = (
      <div
        data-show="$foo"
        style="display: none"
      ></div>
    )

    expect(renderToString(node)).toBe('<div data-show="$foo" style="display: none"></div>')
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="bar"
        data-show="el.id === 'bar'"
      ></div>
    )

    expect(renderToString(node)).toBe('<div id="bar" data-show="el.id === &#39;bar&#39;"></div>')
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <div data-show></div>
        <div data-show={false}></div>
        <div data-show={0}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-show="true"></div><div data-show="false"></div><div data-show="0"></div></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:foo="false"
        data-show="$foo"
        data-text="$foo ? 'shown' : 'hidden'"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:foo="false" data-show="$foo" data-text="$foo ? &#39;shown&#39; : &#39;hidden&#39;"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-show has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-show": mod(signal<boolean>("foo"), { delay: "100ms" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-show" does not accept modifiers')
  })
})
