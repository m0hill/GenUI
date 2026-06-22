import { describe, expect, it } from "vitest"
import { mod, preserve } from "../src/ds/index.js"
import { h, HtmlNameError, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-preserve-attr", () => {
  it("renders single preserved attribute with the hyperscript factory", () => {
    const node = h(
      "details",
      { open: true, "data-preserve-attr": "open" },
      h("summary", {}, "Title"),
      "Content"
    )

    expect(renderToString(node)).toBe(
      '<details open data-preserve-attr="open"><summary>Title</summary>Content</details>'
    )
  })

  it("renders multiple preserved attributes with JSX strings", () => {
    const node = (
      <details
        open
        class="foo"
        data-preserve-attr="open class"
      >
        <summary>Title</summary>
        Content
      </details>
    )

    expect(renderToString(node)).toBe(
      '<details open class="foo" data-preserve-attr="open class"><summary>Title</summary>Content</details>'
    )
  })

  it("renders data-preserve-attr helper output", () => {
    const node = (
      <details
        open
        class="foo"
        data-preserve-attr={preserve("open", "class", "aria-expanded")}
      ></details>
    )

    expect(renderToString(node)).toBe(
      '<details open class="foo" data-preserve-attr="open class aria-expanded"></details>'
    )
  })

  it("escapes hand-written preserve lists like ordinary HTML attribute values", () => {
    const node = <div data-preserve-attr="title data-note"></div>

    expect(renderToString(node)).toBe('<div data-preserve-attr="title data-note"></div>')
  })

  it("preserves authored attribute order for morphing semantics", () => {
    const node = (
      <input
        value="server"
        checked
        data-preserve-attr={preserve("value", "checked")}
      />
    )

    expect(renderToString(node)).toBe(
      '<input value="server" checked data-preserve-attr="value checked">'
    )
  })

  it("rejects invalid attribute names in the preserve helper", () => {
    expect(() => preserve("open", "bad name")).toThrow(HtmlNameError)
    expect(() => preserve("data-ok", "bad=attr")).toThrow(HtmlNameError)
  })

  it("rejects explicit modifier wrappers because data-preserve-attr has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("details", {
        "data-preserve-attr": mod("open", { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-preserve-attr" does not accept modifiers')
  })
})
