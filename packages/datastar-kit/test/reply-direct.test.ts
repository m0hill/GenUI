import { describe, expect, it } from "vitest"
import { h } from "../src/html.js"
import * as reply from "../src/reply.js"

if (false) {
  // @ts-expect-error Datastar action body replies own their protocol status.
  reply.directSignals({ count: 1 }, {}, { status: 200 })
  // @ts-expect-error Datastar action body replies own their protocol status.
  reply.patch(h("p", {}, "Updated"), {}, { status: 200 })
  // @ts-expect-error Datastar action body replies own their protocol status.
  reply.signals({ count: 1 }, {}, { status: 200 })
  // @ts-expect-error Datastar no-content replies own their protocol status.
  reply.done({ status: 204 })
  // @ts-expect-error High-level signal replies require a signal-state object.
  reply.signals('{"count":1}')
  // @ts-expect-error Direct JSON signal replies require a signal-state object.
  reply.directSignals('{"count":1}')
}

describe("reply direct Datastar responses", () => {
  it("serves full Datastar pages with normal page status options", async () => {
    const response = reply.page(
      h("main", {}, "Ada & Grace"),
      {},
      { status: 201, headers: { "x-html": "yes" } }
    )
    const html = await response.text()

    expect(response.status).toBe(201)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(response.headers.get("x-html")).toBe("yes")
    expect(html).toContain("<main>Ada &amp; Grace</main>")
  })

  it("serves direct HTML patch responses as explicit escape hatches", async () => {
    const response = reply.directHtml(h("p", {}, "Updated"), {
      selector: "#slot",
      mode: "inner",
      namespace: "svg",
      useViewTransition: true
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("datastar-selector")).toBe("#slot")
    expect(response.headers.get("datastar-mode")).toBe("inner")
    expect(response.headers.get("datastar-namespace")).toBe("svg")
    expect(response.headers.get("datastar-use-view-transition")).toBe("true")
    expect(await response.text()).toBe("<p>Updated</p>")
  })

  it("serves direct JSON signal responses as explicit escape hatches", async () => {
    const response = reply.directSignals({ count: 1 }, { onlyIfMissing: true })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(response.headers.get("datastar-only-if-missing")).toBe("true")
    expect(await response.text()).toBe('{"count":1}')
  })

  it("serves direct script responses as explicit escape hatches", async () => {
    const response = reply.directScript("console.log('hello')", {
      attributes: { type: "module", async: true }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(response.headers.get("datastar-script-attributes")).toBe(
      '{"type":"module","async":true}'
    )
    expect(await response.text()).toBe("console.log('hello')")
  })

  it("serves safe navigation script responses", async () => {
    const response = reply.navigate("/dashboard?from=login#top", { baseUrl: "https://app.example" })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(await response.text()).toBe(
      'setTimeout(() => { window.location.href = "/dashboard?from=login#top" })'
    )
  })

  it("allows navigation to explicit origin allowlists only", async () => {
    const response = reply.navigate("https://docs.example/start", {
      baseUrl: "https://app.example",
      allowedOrigins: ["https://docs.example"]
    })

    expect(await response.text()).toBe(
      'setTimeout(() => { window.location.href = "https://docs.example/start" })'
    )
    expect(() =>
      reply.navigate("https://evil.example/phish", { baseUrl: "https://app.example" })
    ).toThrow(reply.NavigationUrlError)
    expect(() => reply.navigate("javascript:alert(1)", { baseUrl: "https://app.example" })).toThrow(
      reply.NavigationUrlError
    )
    expect(() =>
      reply.navigate("/safe\nSet-Cookie: bad", { baseUrl: "https://app.example" })
    ).toThrow(reply.NavigationUrlError)
  })

  it("keeps Datastar action replies on 200-with-body or 204-without-body status semantics", async () => {
    const signals = reply.directSignals({ count: 1 })
    const empty = reply.done()

    expect(signals.status).toBe(200)
    expect(signals.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(await signals.text()).toBe('{"count":1}')
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe("")
  })
})
