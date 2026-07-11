import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-computed", () => {
  it("renders keyed computed expressions with the hyperscript factory", () => {
    const node = h("div", { "data-computed:foo": "$bar + $baz" })

    expect(renderToString(node)).toBe('<div data-computed:foo="$bar + $baz"></div>')
  })

  it("renders raw object expressions with callable values using the hyperscript factory", () => {
    const node = h("div", { "data-computed": "{foo: () => $bar + $baz}" })

    expect(renderToString(node)).toBe('<div data-computed="{foo: () =&gt; $bar + $baz}"></div>')
  })

  it("renders keyed JSX values from signal refs and expression helpers", () => {
    const bar = signal<number>("bar")
    const baz = signal<number>("baz")

    const node = (
      <div>
        <div data-computed:foo={js`${bar} + ${baz}`}></div>
        <div data-text={signal<number>("foo")}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-computed:foo="$bar + $baz"></div><div data-text="$foo"></div></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = (
      <div
        data-computed:foo="$bar + $baz"
        data-computed:with-el="el.id + ':' + $bar"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-computed:foo="$bar + $baz" data-computed:with-el="el.id + &#39;:&#39; + $bar"></div>'
    )
  })

  it("renders normal hand-written Datastar object syntax through JSX", () => {
    const node = <div data-computed="{foo: () => $bar + $baz}"></div>

    expect(renderToString(node)).toBe('<div data-computed="{foo: () =&gt; $bar + $baz}"></div>')
  })

  it("serializes object syntax with callable expression helpers", () => {
    const bar = signal<number>("bar")
    const baz = signal<number>("baz")

    const node = (
      <div
        data-computed={{
          foo: js`() => ${bar} + ${baz}`,
          ready: js`() => ${bar} > ${0}`,
          nested: {
            label: js`() => ${"count:"} + ${bar}`
          }
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-computed="{&quot;foo&quot;: () =&gt; $bar + $baz, &quot;ready&quot;: () =&gt; $bar &gt; 0, &quot;nested&quot;: {&quot;label&quot;: () =&gt; &quot;count:&quot; + $bar}}"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div
        data-computed:always
        data-computed:never={false}
        data-computed:zero={0}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-computed:always="true" data-computed:never="false" data-computed:zero="0"></div>'
    )
  })

  it("renders case modifiers for keyed computed signal names", () => {
    const total = js<number>("$bar + $baz")

    const node = (
      <div>
        <div data-computed:my-signal={mod(total, { case: "camel" })}></div>
        <div data-computed:my-signal={mod(total, { case: "snake" })}></div>
        <div data-computed:my-signal={mod(total, { case: "kebab" })}></div>
        <div data-computed:my-signal={mod(total, { case: "pascal" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-computed:my-signal__case.camel="$bar + $baz"></div><div data-computed:my-signal__case.snake="$bar + $baz"></div><div data-computed:my-signal__case.kebab="$bar + $baz"></div><div data-computed:my-signal__case.pascal="$bar + $baz"></div></div>'
    )
  })

  it("renders normal hand-written case modifier syntax through JSX", () => {
    const node = <div {...{ "data-computed:my-signal__case.kebab": "$bar + $baz" }}></div>

    expect(renderToString(node)).toBe(
      '<div data-computed:my-signal__case.kebab="$bar + $baz"></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-computed:foo="$bar + $baz"
        data-text="$foo"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-computed:foo="$bar + $baz" data-text="$foo"></div>'
    )
  })

  it("rejects explicit modifiers that data-computed does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-computed:foo": mod(js("$bar + $baz"), { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-computed:foo"')
  })

  it("rejects explicit modifiers on unkeyed data-computed because upstream only applies case to keys", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-computed": mod({ foo: js`() => $bar + $baz` }, { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-computed" does not accept modifiers')
  })
})
