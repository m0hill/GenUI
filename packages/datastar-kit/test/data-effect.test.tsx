import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-effect", () => {
  it("renders effect expressions with the hyperscript factory", () => {
    const node = h("div", { "data-effect": "$foo = $bar + $baz" })

    expect(renderToString(node)).toBe('<div data-effect="$foo = $bar + $baz"></div>')
  })

  it("renders JSX effect values from signal refs and expression helpers", () => {
    const bar = signal<number>("bar")
    const baz = signal<number>("baz")

    const node = (
      <div>
        <div data-effect={js`${signal<number>("foo")} = ${bar} + ${baz}`}></div>
        <div data-effect={signal<boolean>("ready")}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-effect="$foo = $bar + $baz"></div><div data-effect="$ready"></div></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = (
      <div
        data-effect="$foo = $bar + $baz"
        data-effect-log="ordinary data attribute"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-effect="$foo = $bar + $baz" data-effect-log="ordinary data attribute"></div>'
    )
  })

  it("renders normal hand-written Datastar action expressions through JSX", () => {
    const node = <div data-effect="$foo && @get('/sync')"></div>

    expect(renderToString(node)).toBe(
      '<div data-effect="$foo &amp;&amp; @get(&#39;/sync&#39;)"></div>'
    )
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="bar"
        data-effect={js`$foo = ${signal<string>("prefix")} + el.id`}
      ></div>
    )

    expect(renderToString(node)).toBe('<div id="bar" data-effect="$foo = $prefix + el.id"></div>')
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <div data-effect></div>
        <div data-effect={false}></div>
        <div data-effect={0}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-effect="true"></div><div data-effect="false"></div><div data-effect="0"></div></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:foo="0"
        data-effect="$foo = $bar + $baz"
        data-text="$foo"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:foo="0" data-effect="$foo = $bar + $baz" data-text="$foo"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-effect has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-effect": mod(js("$foo = $bar + $baz"), { delay: "100ms" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-effect" does not accept modifiers')
  })
})
