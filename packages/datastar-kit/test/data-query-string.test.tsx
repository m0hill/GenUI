import { describe, expect, it } from "vitest"
import { mod } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-query-string", () => {
  it("renders the presence form with the hyperscript factory", () => {
    const node = h("main", { "data-query-string": true })

    expect(renderToString(node)).toBe("<main data-query-string></main>")
  })

  it("renders the JSX presence form", () => {
    const node = <main data-query-string></main>

    expect(renderToString(node)).toBe("<main data-query-string></main>")
  })

  it("omits data-query-string when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <main data-query-string={false}></main>
        <main data-query-string={null}></main>
        <main data-query-string={undefined}></main>
      </div>
    )

    expect(renderToString(node)).toBe("<div><main></main><main></main><main></main></div>")
  })

  it("keeps hand-written values as ordinary attribute values", () => {
    const node = <main data-query-string="push"></main>

    expect(renderToString(node)).toBe('<main data-query-string="push"></main>')
  })

  it("rejects explicit modifier wrappers because data-query-string has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("main", {
        "data-query-string": mod({ ifMissing: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-query-string" does not accept modifiers')
  })
})
