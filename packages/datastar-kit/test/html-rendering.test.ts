import { describe, expect, it } from "vitest"
import { h, HtmlNameError, mergeProps, renderToString, unsafeHtml } from "../src/html.js"

describe("HTML rendering boundary", () => {
  it("escapes text by default and requires explicit unsafe HTML", () => {
    expect(renderToString(h("p", {}, "<script>alert(1)</script>"))).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
    )
    expect(renderToString(h("p", {}, unsafeHtml("<strong>trusted</strong>")))).toBe(
      "<p><strong>trusted</strong></p>"
    )
  })

  it("rejects unsafe tag and rendered attribute names", () => {
    expect(() => h('div onclick="alert(1)"')).toThrow(HtmlNameError)

    expect(() => renderToString(h("button", { 'data-x" onclick="alert(1)': true }))).toThrow(
      HtmlNameError
    )

    expect(() => renderToString(h("button", { 'data-x" onclick="alert(1)': false }))).toThrow(
      HtmlNameError
    )
  })

  it("renders boolean attributes as presence-only attributes", () => {
    expect(renderToString(h("button", { disabled: true }, "Save"))).toBe(
      "<button disabled>Save</button>"
    )
    expect(renderToString(h("button", { disabled: false }, "Save"))).toBe("<button>Save</button>")
    expect(renderToString(h("details", { open: true }))).toBe("<details open></details>")
    expect(renderToString(h("details", { open: false }))).toBe("<details></details>")
    expect(renderToString(h("a", { download: true }, "Download"))).toBe("<a download>Download</a>")
    expect(renderToString(h("a", { download: "report.csv" }, "Download"))).toBe(
      '<a download="report.csv">Download</a>'
    )
    expect(renderToString(h("input", { type: "file", capture: false }))).toBe('<input type="file">')
    expect(
      renderToString(h("video", { disablepictureinpicture: true, disableremoteplayback: false }))
    ).toBe("<video disablepictureinpicture></video>")
    expect(renderToString(h("iframe", { credentialless: true }))).toBe(
      "<iframe credentialless></iframe>"
    )
    expect(renderToString(h("template", { shadowrootdelegatesfocus: true }))).toBe(
      "<template shadowrootdelegatesfocus></template>"
    )
  })

  it("renders boolean values on string-valued attributes", () => {
    expect(renderToString(h("div", { "aria-hidden": false, "aria-expanded": true }))).toBe(
      '<div aria-hidden="false" aria-expanded="true"></div>'
    )
    expect(renderToString(h("div", { draggable: false, contenteditable: true }))).toBe(
      '<div draggable="false" contenteditable="true"></div>'
    )
    expect(renderToString(h("div", { "data-enabled": false, "data-active": true }))).toBe(
      '<div data-enabled="false" data-active="true"></div>'
    )
  })

  it("keeps known Datastar presence attributes presence-based", () => {
    expect(
      renderToString(
        h("div", {
          "data-ignore": true,
          "data-persist": true,
          "data-persist:profile": true,
          "data-query-string": true,
          "data-ref:panel": true,
          "data-scope-children": true,
          "data-scroll-into-view": true,
          "data-signals:result": true,
          "data-signals:cached__ifmissing": true
        })
      )
    ).toBe(
      "<div data-ignore data-persist data-persist:profile data-query-string data-ref:panel data-scope-children data-scroll-into-view data-signals:result data-signals:cached__ifmissing></div>"
    )
    expect(
      renderToString(
        h("div", {
          "data-ignore": false,
          "data-persist": false,
          "data-persist:profile": false,
          "data-query-string": false,
          "data-ref:panel": false,
          "data-scope-children": false,
          "data-scroll-into-view": false,
          "data-signals:result": false,
          "data-signals:cached__ifmissing": false
        })
      )
    ).toBe("<div></div>")
  })

  it("composes props with later values overriding earlier values", () => {
    expect(mergeProps({ class: "base", id: "old" }, { id: "new", hidden: true })).toEqual({
      class: "base",
      id: "new",
      hidden: true
    })
  })

  it("renders composed Datastar props in object insertion order", () => {
    const node = h(
      "main",
      mergeProps(
        { id: "counter" },
        { "data-signals__ifmissing": '{"count": 0}' },
        { "data-text": "$count" }
      ),
      "0"
    )

    expect(renderToString(node)).toBe(
      '<main id="counter" data-signals__ifmissing="{&quot;count&quot;: 0}" data-text="$count">0</main>'
    )
  })

  it("renders child arrays", () => {
    expect(renderToString([h("span", {}, "A"), h("span", {}, "B")])).toBe(
      "<span>A</span><span>B</span>"
    )
  })

  it("renders boolean children as empty strings", () => {
    expect(renderToString(true)).toBe("")
    expect(renderToString(false)).toBe("")
    expect(renderToString(h("div", {}, true, "x", false))).toBe("<div>x</div>")
  })

  it("keeps stable patch ids as plain explicit props", () => {
    const node = h("section", { id: "profile" }, "Ada")

    expect(node.props.id).toBe("profile")
    expect(renderToString(node)).toBe('<section id="profile">Ada</section>')
  })
})
