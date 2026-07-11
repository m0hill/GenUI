import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { executeScript, patchElements, patchSignals } from "../src/sse.js"

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../../datastar/sdk/test/get-cases/${name}/output.txt`, import.meta.url),
    "utf8"
  )

describe("additional Datastar SDK fixtures", () => {
  it("matches the multiline patch-elements fixture", () => {
    expect(patchElements("<div>\n  <span>Merge</span>\n</div>")).toBe(
      fixture("patchElementsWithMultilineElements")
    )
  })

  it("matches the multiline patch-signals fixture", () => {
    expect(patchSignals({ one: "first\n signal", two: "second signal" })).toBe(
      fixture("patchSignalsWithMultilineSignals")
    )
  })

  it("matches the raw multiline patch-signals fixture", () => {
    expect(patchSignals('{\n"one": "first signal",\n"two":  \n"second signal"}')).toBe(
      fixture("patchSignalsWithMultilineJson")
    )
  })

  it("matches remove-elements fixtures through remove mode", () => {
    expect(
      patchElements("", {
        id: "event1",
        retry: 2000,
        selector: "#target",
        mode: "remove",
        useViewTransition: true
      })
    ).toBe(fixture("removeElementsWithAllOptions"))
  })

  it("matches remove-signals fixtures through explicit null patches", () => {
    expect(patchSignals({ one: null })).toBe(fixture("removeSignalsWithDefaults"))
    expect(patchSignals({ one: null, two: { alpha: null } }, { id: "event1", retry: 2000 })).toBe(
      fixture("removeSignalsWithAllOptions")
    )
  })

  it("matches execute-script fixtures", () => {
    expect(executeScript("console.log('hello');")).toBe(fixture("executeScriptWithDefaults"))
    expect(
      executeScript("console.log('hello');", {
        id: "event1",
        retry: 2000,
        attributes: {
          type: "text/javascript",
          blocking: "false"
        },
        autoRemove: false
      })
    ).toBe(fixture("executeScriptWithAllOptions"))
  })
})
