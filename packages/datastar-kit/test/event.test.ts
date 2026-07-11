import { describe, expect, it } from "vitest"
import * as event from "../src/event.js"
import { h, unsafeHtml } from "../src/html.js"

if (false) {
  // @ts-expect-error Blessed event helpers require a signal-state object.
  event.signals('{"title":""}')
}

describe("Datastar SSE event helpers", () => {
  it("builds SSE comment chunks for manual heartbeats", () => {
    expect(event.comment("tick")).toBe(": tick\n\n")
  })

  it("renders HTML nodes into patch events", () => {
    expect(event.patch(h("output", { id: "count" }, 2), { selector: "#count" })).toBe(
      'event: datastar-patch-elements\ndata: selector #count\ndata: elements <output id="count">2</output>\n\n'
    )
  })

  it("keeps unsafe HTML explicit at the HTML boundary", () => {
    expect(event.patch(unsafeHtml("<strong>Saved</strong>"))).toBe(
      "event: datastar-patch-elements\ndata: elements <strong>Saved</strong>\n\n"
    )
  })

  it("builds signal and script events", () => {
    expect(event.signals({ title: "" })).toBe(
      'event: datastar-patch-signals\ndata: signals {"title":""}\n\n'
    )
    expect(event.script("console.log('hello')")).toContain("data: elements <script")
  })

  it("builds safe navigation events", () => {
    expect(event.navigate("/issues/1", { baseUrl: "https://app.example" })).toBe(
      'event: datastar-patch-elements\ndata: mode append\ndata: selector body\ndata: elements <script data-effect="el.remove()">setTimeout(() => { window.location.href = "/issues/1" })</script>\n\n'
    )

    expect(() => event.navigate("javascript:alert(1)", { baseUrl: "https://app.example" })).toThrow(
      event.NavigationUrlError
    )
  })
})
