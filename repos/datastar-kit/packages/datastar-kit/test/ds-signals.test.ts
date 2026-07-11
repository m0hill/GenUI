import { describe, expect, it } from "vitest"
import { local, signal, SignalNameError } from "../src/ds/index.js"

describe("Datastar signal refs", () => {
  it("accepts normal, nested, and local signal names", () => {
    const form = signal<{ email: string }, "form">("form")

    expect(signal<number, "count">("count").toDatastarExpression()).toBe("$count")
    expect(signal<string, "form.email">("form.email").toDatastarExpression()).toBe("$form.email")
    expect(signal<boolean, "_fetching">("_fetching").toDatastarExpression()).toBe("$_fetching")
    expect(form.path("email").toDatastarExpression()).toBe("$form.email")
  })

  it("rejects names Datastar would case-convert or fail to address predictably", () => {
    expect(() => signal<unknown, "first-name">("first-name")).toThrow(SignalNameError)
    expect(() => signal<unknown, "1count">("1count")).toThrow(SignalNameError)
    expect(() => signal<unknown, "form..email">("form..email")).toThrow(SignalNameError)
    expect(() => signal<unknown, "">("")).toThrow(SignalNameError)
  })

  it("creates underscore-prefixed local signal refs without double-prefixing", () => {
    expect(local<boolean>("saving").toDatastarExpression()).toBe("$_saving")
    expect(local<boolean, "_saving">("_saving").toDatastarExpression()).toBe("$_saving")
  })

  it("throws early for invalid nested paths", () => {
    const form = signal<{ email: string }, "form">("form")

    expect(() => form.path("bad-key" as never)).toThrow(SignalNameError)
  })
})
