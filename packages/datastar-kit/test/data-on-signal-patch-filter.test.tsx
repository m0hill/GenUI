import { describe, expect, it } from "vitest"
import { js, mod, regex } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-on-signal-patch-filter", () => {
  it("renders raw filter expressions with the hyperscript factory", () => {
    const node = h("div", { "data-on-signal-patch-filter": "{include: /^counter$/}" })

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{include: /^counter$/}"></div>'
    )
  })

  it("keeps string JSX filter values as raw Datastar expressions", () => {
    const node = <div data-on-signal-patch-filter="{exclude: /changes$/}"></div>

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{exclude: /changes$/}"></div>'
    )
  })

  it("renders combined include and exclude filters through JSX", () => {
    const node = <div data-on-signal-patch-filter="{include: /user/, exclude: /password/}"></div>

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{include: /user/, exclude: /password/}"></div>'
    )
  })

  it("serializes filter objects with native regular expressions", () => {
    const node = (
      <div data-on-signal-patch-filter={{ include: /^counter$/, exclude: /changes$/ }}></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{&quot;include&quot;: new RegExp(&quot;^counter$&quot;, &quot;&quot;), &quot;exclude&quot;: new RegExp(&quot;changes$&quot;, &quot;&quot;)}"></div>'
    )
  })

  it("serializes filter objects with regex expression helpers and strings", () => {
    const node = (
      <div data-on-signal-patch-filter={{ include: regex("user", "i"), exclude: "password" }}></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{&quot;include&quot;: new RegExp(&quot;user&quot;, &quot;i&quot;), &quot;exclude&quot;: &quot;password&quot;}"></div>'
    )
  })

  it("renders raw expression helpers for filter objects", () => {
    const node = <div data-on-signal-patch-filter={js("{include: /^app/}")}></div>

    expect(renderToString(node)).toBe('<div data-on-signal-patch-filter="{include: /^app/}"></div>')
  })

  it("renders the filter alongside data-on-signal-patch", () => {
    const node = (
      <div
        data-on-signal-patch-filter={{ include: /^counter$/ }}
        data-on-signal-patch="console.log(patch)"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{&quot;include&quot;: new RegExp(&quot;^counter$&quot;, &quot;&quot;)}" data-on-signal-patch="console.log(patch)"></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:counter="0"
        data-on-signal-patch-filter="{include: /^counter$/}"
        data-on-signal-patch="console.log(patch)"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:counter="0" data-on-signal-patch-filter="{include: /^counter$/}" data-on-signal-patch="console.log(patch)"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-on-signal-patch-filter has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-on-signal-patch-filter": mod({ include: /^counter$/ }, { debounce: "500ms" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-on-signal-patch-filter" does not accept modifiers')
  })
})
