import { describe, expect, it } from "vitest"
import { mod } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-scroll-into-view", () => {
  it("renders the presence form with the hyperscript factory", () => {
    const node = h("section", { id: "latest", "data-scroll-into-view": true })

    expect(renderToString(node)).toBe('<section id="latest" data-scroll-into-view></section>')
  })

  it("renders the JSX presence form", () => {
    const node = <section data-scroll-into-view>Latest</section>

    expect(renderToString(node)).toBe("<section data-scroll-into-view>Latest</section>")
  })

  it("omits data-scroll-into-view when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <section data-scroll-into-view={false}></section>
        <section data-scroll-into-view={null}></section>
        <section data-scroll-into-view={undefined}></section>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><section></section><section></section><section></section></div>"
    )
  })

  it("keeps hand-written values as ordinary attribute values", () => {
    const node = <section data-scroll-into-view="smooth"></section>

    expect(renderToString(node)).toBe('<section data-scroll-into-view="smooth"></section>')
  })

  it("rejects explicit modifier wrappers because data-scroll-into-view has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("section", {
        "data-scroll-into-view": mod({ viewTransition: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-scroll-into-view" does not accept modifiers')
  })
})
