import { describe, expect, it } from "vitest"
import { HtmlNameError } from "../src/html.js"
import { comment, executeScript, patchElements, patchSignals, SseFieldError } from "../src/sse.js"

describe("Datastar SSE encoding", () => {
  it("encodes SSE comments for manual heartbeats", () => {
    expect(comment()).toBe(":\n\n")
    expect(comment("heartbeat")).toBe(": heartbeat\n\n")
    expect(comment("one\r\ntwo\rthree\nfour")).toBe(": one\n: two\n: three\n: four\n\n")
  })

  it("encodes default element patches like the SDK fixture", () => {
    expect(patchElements("<div>Merge</div>")).toBe(
      "event: datastar-patch-elements\ndata: elements <div>Merge</div>\n\n"
    )
  })

  it("encodes element patch options in Datastar SDK order", () => {
    expect(
      patchElements("<div>Merge</div>", {
        id: "event1",
        retry: 2000,
        selector: "div",
        mode: "append",
        useViewTransition: true
      })
    ).toBe(
      "event: datastar-patch-elements\nid: event1\nretry: 2000\ndata: selector div\ndata: mode append\ndata: useViewTransition true\ndata: elements <div>Merge</div>\n\n"
    )
  })

  it("encodes scoped view transition selectors for Datastar v1.0.2", () => {
    expect(
      patchElements("<div>Merge</div>", {
        selector: "#target",
        useViewTransition: true,
        viewTransitionSelector: "#transition-scope"
      })
    ).toBe(
      "event: datastar-patch-elements\ndata: selector #target\ndata: useViewTransition true\ndata: viewTransitionSelector #transition-scope\ndata: elements <div>Merge</div>\n\n"
    )
  })

  it("omits scoped view transition selectors when view transitions are disabled", () => {
    expect(
      patchElements("<div>Merge</div>", {
        selector: "#target",
        viewTransitionSelector: "#transition-scope"
      })
    ).toBe(
      "event: datastar-patch-elements\ndata: selector #target\ndata: elements <div>Merge</div>\n\n"
    )
  })

  it("encodes non-default element patch namespaces", () => {
    expect(
      patchElements("<circle></circle>", { selector: "#icon", mode: "inner", namespace: "svg" })
    ).toBe(
      "event: datastar-patch-elements\ndata: selector #icon\ndata: mode inner\ndata: namespace svg\ndata: elements <circle></circle>\n\n"
    )
  })

  it("splits multiline element payloads into repeated data lines", () => {
    expect(patchElements("<div>\n  Hello\n</div>")).toBe(
      "event: datastar-patch-elements\ndata: elements <div>\ndata: elements   Hello\ndata: elements </div>\n\n"
    )
  })

  it("splits carriage-return payloads into repeated data lines", () => {
    expect(patchElements("<div>\r  Hello\r</div>")).toBe(
      "event: datastar-patch-elements\ndata: elements <div>\ndata: elements   Hello\ndata: elements </div>\n\n"
    )
    expect(patchSignals('{"safe":true}\rid: injected')).toBe(
      'event: datastar-patch-signals\ndata: signals {"safe":true}\ndata: signals id: injected\n\n'
    )
  })

  it("rejects newlines in SSE event IDs", () => {
    expect(() => patchElements("<div/>", { id: "a\nb" })).toThrow(SseFieldError)
    expect(() => patchSignals({ a: 1 }, { id: "bad\nid" })).toThrow(SseFieldError)
  })

  it("rejects newlines in element selector fields", () => {
    expect(() => patchElements("<div/>", { selector: "#x\ndata: elements <script>" })).toThrow(
      SseFieldError
    )
  })

  it("rejects carriage returns in emitted scoped view transition selector fields", () => {
    expect(() =>
      patchElements("<div/>", { useViewTransition: true, viewTransitionSelector: "#x\r\n" })
    ).toThrow(SseFieldError)
  })

  it("encodes element removal through patch options", () => {
    expect(patchElements("", { selector: "#target", mode: "remove" })).toBe(
      "event: datastar-patch-elements\ndata: selector #target\ndata: mode remove\n\n"
    )
  })

  it("allows element removal without an elements argument", () => {
    expect(patchElements(undefined, { selector: "#target", mode: "remove" })).toBe(
      "event: datastar-patch-elements\ndata: selector #target\ndata: mode remove\n\n"
    )
  })

  it("omits default retry durations", () => {
    expect(patchElements("<div>Merge</div>", { retry: 1000 })).toBe(
      "event: datastar-patch-elements\ndata: elements <div>Merge</div>\n\n"
    )
    expect(patchSignals({ one: 1 }, { retry: 1000 })).toBe(
      'event: datastar-patch-signals\ndata: signals {"one":1}\n\n'
    )
  })

  it("encodes signal patches from objects", () => {
    expect(patchSignals({ one: 1, two: 2 })).toBe(
      'event: datastar-patch-signals\ndata: signals {"one":1,"two":2}\n\n'
    )
  })

  it("encodes signal patch options like the SDK fixture", () => {
    expect(
      patchSignals(
        { one: 1, two: 2 },
        {
          id: "event1",
          retry: 2000,
          onlyIfMissing: true
        }
      )
    ).toBe(
      'event: datastar-patch-signals\nid: event1\nretry: 2000\ndata: onlyIfMissing true\ndata: signals {"one":1,"two":2}\n\n'
    )
  })

  it("returns complete event strings that can be concatenated into a stream", () => {
    expect([patchElements("<div>One</div>"), patchElements("<div>Two</div>")].join("")).toBe(
      "event: datastar-patch-elements\ndata: elements <div>One</div>\n\nevent: datastar-patch-elements\ndata: elements <div>Two</div>\n\n"
    )
  })

  it("encodes script attributes and auto-removal explicitly", () => {
    expect(
      executeScript("console.log('<')", {
        attributes: { type: "module", "data-note": "A&B\"'" },
        autoRemove: false
      })
    ).toBe(
      'event: datastar-patch-elements\ndata: mode append\ndata: selector body\ndata: elements <script type="module" data-note="A&amp;B&quot;&#39;">console.log(\'<\')</script>\n\n'
    )
  })

  it("escapes </script> breakout sequences in the script body", () => {
    const out = executeScript('console.log("</script>")')

    expect(out).toContain('console.log("<\\/script>")')
    expect(out.split("</script>")).toHaveLength(2)
  })

  it("escapes </script> breakout sequences case-insensitively", () => {
    const out = executeScript("x = '</SCRIPT>'")

    expect(out).toContain("x = '<\\/SCRIPT>'")
    expect(out.split("</script>")).toHaveLength(2)
  })

  it("escapes HTML comment openers in the script body", () => {
    const out = executeScript("x = '<!-- hi'")

    expect(out).toContain("x = '<\\!-- hi'")
    expect(out).not.toContain("<!-- hi")
  })

  it("leaves ordinary script bodies unchanged", () => {
    expect(executeScript("window.answer = 42")).toContain(
      '<script data-effect="el.remove()">window.answer = 42</script>'
    )
  })

  it("validates script event attribute names like the HTML renderer", () => {
    expect(() =>
      executeScript("console.log('hello')", {
        attributes: { 'type" onclick="alert(1)': "module" }
      })
    ).toThrow(HtmlNameError)
  })
})
