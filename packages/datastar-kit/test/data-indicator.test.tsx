import { describe, expect, it } from "vitest"
import { get, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-indicator", () => {
  it("renders keyed presence form with the hyperscript factory", () => {
    const node = h("button", {
      "data-on:click": "@get('/endpoint')",
      "data-indicator:fetching": true
    })

    expect(renderToString(node)).toBe(
      '<button data-on:click="@get(&#39;/endpoint&#39;)" data-indicator:fetching></button>'
    )
  })

  it("renders value form with the hyperscript factory", () => {
    const node = h("button", { "data-indicator": "fetching" })

    expect(renderToString(node)).toBe('<button data-indicator="fetching"></button>')
  })

  it("renders documented loading indicator markup through JSX", () => {
    const fetching = signal<boolean, "fetching">("fetching")

    const node = (
      <div>
        <button
          data-on:click={get("/endpoint")}
          data-indicator:fetching
          data-attr:disabled={fetching}
        ></button>
        <div data-show={fetching}>Loading...</div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-on:click="@get(&quot;/endpoint&quot;)" data-indicator:fetching data-attr:disabled="$fetching"></button><div data-show="$fetching">Loading...</div></div>'
    )
  })

  it("renders JSX value form from plain signal names and Signal refs", () => {
    const fetching = signal<boolean, "fetching">("fetching")

    const node = (
      <div>
        <button data-indicator="fetching"></button>
        <button data-indicator={fetching}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-indicator="fetching"></button><button data-indicator="fetching"></button></div>'
    )
  })

  it("omits keyed indicator attributes when the JSX value is false, null, or undefined", () => {
    const node = (
      <div>
        <button data-indicator:active={false}></button>
        <button data-indicator:active={null}></button>
        <button data-indicator:active={undefined}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><button></button><button></button><button></button></div>"
    )
  })

  it("renders case modifiers for keyed indicator signal names", () => {
    const node = (
      <div>
        <button data-indicator:my-fetch={mod({ case: "camel" })}></button>
        <button data-indicator:my-fetch={mod({ case: "snake" })}></button>
        <button data-indicator:my-fetch={mod({ case: "kebab" })}></button>
        <button data-indicator:my-fetch={mod({ case: "pascal" })}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><button data-indicator:my-fetch__case.camel></button><button data-indicator:my-fetch__case.snake></button><button data-indicator:my-fetch__case.kebab></button><button data-indicator:my-fetch__case.pascal></button></div>"
    )
  })

  it("renders normal hand-written case modifier syntax through JSX", () => {
    const node = <button {...{ "data-indicator:my-fetch__case.snake": true }}></button>

    expect(renderToString(node)).toBe("<button data-indicator:my-fetch__case.snake></button>")
  })

  it("preserves authored order when indicator is needed before data-init", () => {
    const node = (
      <div
        data-indicator:fetching
        data-init={get("/endpoint")}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-indicator:fetching data-init="@get(&quot;/endpoint&quot;)"></div>'
    )
  })

  it("rejects explicit modifiers that data-indicator does not support", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-indicator:fetching": mod({ prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-indicator:fetching"')
  })

  it("rejects case modifiers on unkeyed data-indicator because upstream only applies case to keys", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-indicator": mod(signal<boolean>("fetching"), { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-indicator" does not accept modifiers')
  })
})
