import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-style", () => {
  it("renders keyed style expressions with the hyperscript factory", () => {
    const node = h("div", { "data-style:display": "$hiding && 'none'" })

    expect(renderToString(node)).toBe(
      '<div data-style:display="$hiding &amp;&amp; &#39;none&#39;"></div>'
    )
  })

  it("renders raw object expressions with the hyperscript factory", () => {
    const node = h("div", {
      "data-style":
        "{display: $hiding ? 'none' : 'flex', 'background-color': $red ? 'red' : 'green'}"
    })

    expect(renderToString(node)).toBe(
      '<div data-style="{display: $hiding ? &#39;none&#39; : &#39;flex&#39;, &#39;background-color&#39;: $red ? &#39;red&#39; : &#39;green&#39;}"></div>'
    )
  })

  it("renders keyed JSX values from signal refs and expression helpers", () => {
    const hiding = signal<boolean>("hiding")
    const red = signal<boolean>("red")

    const node = (
      <div
        data-style:display={js`${hiding} && ${"none"}`}
        data-style:background-color={js`${red} ? ${"red"} : ${"blue"}`}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-style:display="$hiding &amp;&amp; &quot;none&quot;" data-style:background-color="$red ? &quot;red&quot; : &quot;blue&quot;"></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = (
      <div
        data-style:display="$hiding && 'none'"
        data-style:background-color="$red ? 'red' : 'blue'"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-style:display="$hiding &amp;&amp; &#39;none&#39;" data-style:background-color="$red ? &#39;red&#39; : &#39;blue&#39;"></div>'
    )
  })

  it("renders normal hand-written Datastar object syntax through JSX", () => {
    const node = (
      <div data-style="{display: $hiding ? 'none' : 'flex', 'background-color': $red ? 'red' : 'green'}"></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-style="{display: $hiding ? &#39;none&#39; : &#39;flex&#39;, &#39;background-color&#39;: $red ? &#39;red&#39; : &#39;green&#39;}"></div>'
    )
  })

  it("serializes object syntax for multiple style properties", () => {
    const hiding = signal<boolean>("hiding")

    const node = (
      <div
        data-style={{
          display: js`${hiding} ? ${"none"} : ${"flex"}`,
          backgroundColor: "red",
          "border-color": "green",
          opacity: 0
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-style="{&quot;display&quot;: $hiding ? &quot;none&quot; : &quot;flex&quot;, &quot;backgroundColor&quot;: &quot;red&quot;, &quot;border-color&quot;: &quot;green&quot;, &quot;opacity&quot;: 0}"></div>'
    )
  })

  it("serializes falsey dynamic values for runtime style restoration", () => {
    const node = (
      <div
        style="display: flex; color: red;"
        data-style:display={false}
        data-style:color={null}
        data-style:background-color={js("undefined")}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div style="display: flex; color: red;" data-style:display="false" data-style:color="null" data-style:background-color="undefined"></div>'
    )
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="panel"
        data-style:width="el.dataset.width"
      ></div>
    )

    expect(renderToString(node)).toBe('<div id="panel" data-style:width="el.dataset.width"></div>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        style="display: flex;"
        data-style:display="$hiding && 'none'"
        data-text="$hiding"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div style="display: flex;" data-style:display="$hiding &amp;&amp; &#39;none&#39;" data-text="$hiding"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-style has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-style:display": mod(signal<boolean>("hiding"), { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-style:display" does not accept modifiers')
  })
})
