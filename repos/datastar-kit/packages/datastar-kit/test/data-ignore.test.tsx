import { describe, expect, it } from "vitest"
import { mod } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-ignore", () => {
  it("renders presence form with the hyperscript factory", () => {
    const node = h(
      "div",
      { "data-ignore": true, "data-show-thirdpartylib": "" },
      h("div", {}, "Datastar will not process this element.")
    )

    expect(renderToString(node)).toBe(
      '<div data-ignore data-show-thirdpartylib=""><div>Datastar will not process this element.</div></div>'
    )
  })

  it("renders JSX presence form", () => {
    const node = (
      <div
        data-ignore
        data-show-thirdpartylib=""
      >
        <div>Datastar will not process this element.</div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div data-ignore data-show-thirdpartylib=""><div>Datastar will not process this element.</div></div>'
    )
  })

  it("omits data-ignore when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <section data-ignore={false}></section>
        <section data-ignore={null}></section>
        <section data-ignore={undefined}></section>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><section></section><section></section><section></section></div>"
    )
  })

  it("renders self modifier with the SDK modifier helper", () => {
    const node = (
      <div data-ignore={mod({ self: true })}>
        <span data-text="$childText"></span>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div data-ignore__self><span data-text="$childText"></span></div>'
    )
  })

  it("renders normal hand-written self modifier syntax through JSX", () => {
    const node = <div {...{ "data-ignore__self": true }}></div>

    expect(renderToString(node)).toBe("<div data-ignore__self></div>")
  })

  it("keeps ordinary string values raw when authored by hand", () => {
    const node = <div data-ignore=""></div>

    expect(renderToString(node)).toBe('<div data-ignore=""></div>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-ignore={mod({ self: true })}
        data-text="$descendantStillProcesses"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-ignore__self data-text="$descendantStillProcesses"></div>'
    )
  })

  it("rejects explicit modifiers that data-ignore does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-ignore": mod({ prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-ignore"')
  })
})
