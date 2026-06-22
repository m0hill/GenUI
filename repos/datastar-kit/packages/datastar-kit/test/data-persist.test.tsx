import { describe, expect, it } from "vitest"
import { mod } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-persist", () => {
  it("renders exact and keyed presence forms with the hyperscript factory", () => {
    const node = h("form", { "data-persist": true, "data-persist:profile": true })

    expect(renderToString(node)).toBe("<form data-persist data-persist:profile></form>")
  })

  it("renders JSX exact and keyed presence forms", () => {
    const node = (
      <form
        data-persist
        data-persist:profile
      ></form>
    )

    expect(renderToString(node)).toBe("<form data-persist data-persist:profile></form>")
  })

  it("omits presence forms when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <form data-persist={false}></form>
        <form data-persist={null}></form>
        <form data-persist={undefined}></form>
        <form data-persist:profile={false}></form>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><form></form><form></form><form></form><form></form></div>"
    )
  })

  it("keeps hand-written persist targets as ordinary attribute values", () => {
    const node = <form data-persist="session local"></form>

    expect(renderToString(node)).toBe('<form data-persist="session local"></form>')
  })

  it("rejects explicit modifier wrappers because data-persist has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("form", {
        "data-persist:profile": mod({ case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-persist:profile" does not accept modifiers')
  })
})
