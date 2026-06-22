import { describe, expect, it } from "vitest"
import { js, mod, regex } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-json-signals", () => {
  it("renders display-all presence form with the hyperscript factory", () => {
    const node = h("pre", { "data-json-signals": true })

    expect(renderToString(node)).toBe("<pre data-json-signals></pre>")
  })

  it("renders raw filter expressions with the hyperscript factory", () => {
    const node = h("pre", { "data-json-signals": "{include: /user/}" })

    expect(renderToString(node)).toBe('<pre data-json-signals="{include: /user/}"></pre>')
  })

  it("renders JSX display-all presence form and omits falsey presence values", () => {
    const node = (
      <div>
        <pre data-json-signals></pre>
        <pre data-json-signals={false}></pre>
        <pre data-json-signals={null}></pre>
        <pre data-json-signals={undefined}></pre>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><pre data-json-signals></pre><pre></pre><pre></pre><pre></pre></div>"
    )
  })

  it("keeps string JSX filter values as raw Datastar expressions", () => {
    const node = <pre data-json-signals="{include: /^app/, exclude: /password/}"></pre>

    expect(renderToString(node)).toBe(
      '<pre data-json-signals="{include: /^app/, exclude: /password/}"></pre>'
    )
  })

  it("serializes filter objects with native regular expressions", () => {
    const node = <pre data-json-signals={{ include: /^app/, exclude: /password/ }}></pre>

    expect(renderToString(node)).toBe(
      '<pre data-json-signals="{&quot;include&quot;: new RegExp(&quot;^app&quot;, &quot;&quot;), &quot;exclude&quot;: new RegExp(&quot;password&quot;, &quot;&quot;)}"></pre>'
    )
  })

  it("serializes filter objects with regex expression helpers and strings", () => {
    const node = <pre data-json-signals={{ include: regex("user", "i"), exclude: "temp$" }}></pre>

    expect(renderToString(node)).toBe(
      '<pre data-json-signals="{&quot;include&quot;: new RegExp(&quot;user&quot;, &quot;i&quot;), &quot;exclude&quot;: &quot;temp$&quot;}"></pre>'
    )
  })

  it("renders raw expression helpers for filter objects", () => {
    const node = <pre data-json-signals={js("{include: /^counter$/}")}></pre>

    expect(renderToString(node)).toBe('<pre data-json-signals="{include: /^counter$/}"></pre>')
  })

  it("renders terse modifier for display-all and filtered forms", () => {
    const node = (
      <div>
        <pre data-json-signals={mod({ terse: true })}></pre>
        <pre data-json-signals={mod({ include: /^counter$/ }, { terse: true })}></pre>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><pre data-json-signals__terse></pre><pre data-json-signals__terse="{&quot;include&quot;: new RegExp(&quot;^counter$&quot;, &quot;&quot;)}"></pre></div>'
    )
  })

  it("renders normal hand-written terse modifier syntax through JSX", () => {
    const node = <pre {...{ "data-json-signals__terse": "{include: /counter/}" }}></pre>

    expect(renderToString(node)).toBe('<pre data-json-signals__terse="{include: /counter/}"></pre>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <pre
        data-signals:counter="0"
        data-json-signals={{ include: /^counter$/ }}
      ></pre>
    )

    expect(renderToString(node)).toBe(
      '<pre data-signals:counter="0" data-json-signals="{&quot;include&quot;: new RegExp(&quot;^counter$&quot;, &quot;&quot;)}"></pre>'
    )
  })

  it("rejects explicit modifiers that data-json-signals does not support", () => {
    expect(() =>
      runtimeJsx("pre", {
        "data-json-signals": mod({ include: /^counter$/ }, { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-json-signals"')
  })
})
