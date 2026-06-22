import { describe, expect, it } from "vitest"
import { mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-ref", () => {
  it("renders keyed presence form with the hyperscript factory", () => {
    const node = h("div", { "data-ref:foo": true })

    expect(renderToString(node)).toBe("<div data-ref:foo></div>")
  })

  it("renders value form with the hyperscript factory", () => {
    const node = h("div", { "data-ref": "foo" })

    expect(renderToString(node)).toBe('<div data-ref="foo"></div>')
  })

  it("renders JSX keyed presence form and signal usage", () => {
    const node = (
      <div>
        <div data-ref:foo></div>
        <span data-text="$foo.tagName"></span>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-ref:foo></div><span data-text="$foo.tagName"></span></div>'
    )
  })

  it("renders JSX value form from plain signal names and Signal refs", () => {
    const panel = signal<HTMLElement, "panel">("panel")

    const node = (
      <div>
        <section data-ref="panel"></section>
        <section data-ref={panel}></section>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><section data-ref="panel"></section><section data-ref="panel"></section></div>'
    )
  })

  it("omits keyed ref attributes when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <section data-ref:panel={false}></section>
        <section data-ref:panel={null}></section>
        <section data-ref:panel={undefined}></section>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><section></section><section></section><section></section></div>"
    )
  })

  it("renders case modifiers for keyed ref signal names", () => {
    const node = (
      <div>
        <div data-ref:my-ref={mod({ case: "camel" })}></div>
        <div data-ref:my-ref={mod({ case: "snake" })}></div>
        <div data-ref:my-ref={mod({ case: "kebab" })}></div>
        <div data-ref:my-ref={mod({ case: "pascal" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><div data-ref:my-ref__case.camel></div><div data-ref:my-ref__case.snake></div><div data-ref:my-ref__case.kebab></div><div data-ref:my-ref__case.pascal></div></div>"
    )
  })

  it("renders normal hand-written case modifier syntax through JSX", () => {
    const node = <div {...{ "data-ref:my-ref__case.kebab": true }}></div>

    expect(renderToString(node)).toBe("<div data-ref:my-ref__case.kebab></div>")
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-ref:panel
        data-init="$panel.focus()"
      ></div>
    )

    expect(renderToString(node)).toBe('<div data-ref:panel data-init="$panel.focus()"></div>')
  })

  it("rejects explicit modifiers that data-ref does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-ref:panel": mod({ prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-ref:panel"')
  })

  it("rejects case modifiers on unkeyed data-ref because upstream only applies case to keys", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-ref": mod(signal<HTMLElement>("panel"), { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-ref" does not accept modifiers')
  })
})
