import { describe, expect, it } from "vitest"
import { h } from "../src/html.js"
import { page } from "../src/reply.js"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

describe("HTML document responses", () => {
  it("renders a doctype and basic document shell", async () => {
    await expect(page(h("main", {}, "Hello")).text()).resolves.toBe(
      '<!doctype html><html lang="en"><head></head><body><main>Hello</main></body></html>'
    )
  })

  it("supports custom lang, title, and head/body children", async () => {
    await expect(
      page([h("main", {}, "Datastar")], {
        lang: "en-US",
        title: "Demo",
        head: h("script", { type: "module", src: DATASTAR_RUNTIME })
      }).text()
    ).resolves.toBe(
      `<!doctype html><html lang="en-US"><head><title>Demo</title><script type="module" src="${DATASTAR_RUNTIME}"></script></head><body><main>Datastar</main></body></html>`
    )
  })
})
