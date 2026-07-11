import { describe, expect, it } from "vitest"
import { SignalNameError, StatePathError, state } from "../src/ds/index.js"
import type { SignalState } from "../src/types.js"

describe("state helpers", () => {
  it("keeps cloned signal defaults for direct data-signals attributes", () => {
    const form = state({ name: "", email: "", errors: { name: "", email: "" } })

    expect(form.defaults).toEqual({ name: "", email: "", errors: { name: "", email: "" } })
  })

  it("does not retain mutable references to caller-owned defaults", () => {
    const defaults = { profile: { name: "Ada" }, tags: ["admin"] }
    const model = state(defaults)

    defaults.profile.name = "Grace"
    defaults.tags.push("editor")

    expect(model.defaults).toEqual({ profile: { name: "Ada" }, tags: ["admin"] })
  })

  it("freezes exposed defaults so reset keeps a stable baseline", () => {
    const model = state({ profile: { name: "Ada" }, tags: ["admin"] })

    expect(Object.isFrozen(model.defaults)).toBe(true)
    expect(Object.isFrozen(model.defaults.profile)).toBe(true)
    expect(Object.isFrozen(model.defaults.tags)).toBe(true)

    expect(() => {
      ;(model.defaults as { profile: { name: string } }).profile.name = "Grace"
    }).toThrow(TypeError)

    expect(model.reset()).toEqual({ profile: { name: "Ada" }, tags: ["admin"] })
  })

  it("returns cloned patch and reset payloads", () => {
    const form = state({ name: "", errors: { name: "" } })
    const patchInput = { errors: { name: "Enter your name" } }

    const patch = form.patch(patchInput)
    patchInput.errors.name = "Changed after patch"

    expect(patch).toEqual({ errors: { name: "Enter your name" } })

    const reset = form.reset()
    const resetErrors = reset.errors as { name: string }
    resetErrors.name = "Changed reset result"

    expect(form.reset()).toEqual({ name: "", errors: { name: "" } })
  })

  it("creates nested signal refs from one defaults object", () => {
    const form = state({ name: "", errors: { name: "" } })

    expect(form.refs.name.toDatastarExpression()).toBe("$name")
    expect(form.refs.errors.name.toDatastarExpression()).toBe("$errors.name")
    expect(form.ref("name").toDatastarExpression()).toBe("$name")
    expect(form.ref("errors").toDatastarExpression()).toBe("$errors")
    expect(form.ref("errors.name").toDatastarExpression()).toBe("$errors.name")
    expect(() => form.ref("errors.missing" as never)).toThrow(StatePathError)
  })

  it("returns type-checked signal patch objects", () => {
    const form = state({ name: "", email: "", errors: { name: "", email: "" } })
    const errors: { readonly name: string; readonly email: string } = {
      name: "Enter your name",
      email: "Enter a valid email"
    }

    const patch: SignalState = form.patch({ errors })

    expect(patch).toEqual({ errors })
  })

  it("allows null patches to remove signals", () => {
    const form = state({ name: "", errors: { name: "", email: "" } })

    expect(form.patch({ name: null, errors: { email: null } })).toEqual({
      name: null,
      errors: { email: null }
    })
    expect(form.reset({ errors: null })).toEqual({ name: "", errors: null })
  })

  it("rejects invalid patch keys and values at compile time", () => {
    const form = state({ name: "", subscribed: false, errors: { name: "", email: "" } })

    if (false) {
      // @ts-expect-error Unknown top-level signal key.
      form.patch({ missing: "" })
      // @ts-expect-error Unknown nested signal key.
      form.patch({ errors: { missing: "" } })
      // @ts-expect-error Signal patch value must match the default value type.
      form.patch({ subscribed: "yes" })
      // @ts-expect-error Reset overrides are checked like signal patches.
      form.reset({ errors: { email: false } })
      // @ts-expect-error Nested object refs are not signal refs themselves.
      form.refs.errors.toDatastarExpression()
      // @ts-expect-error State refs must point to known state paths.
      form.ref("errors.missing")
    }

    expect(form.patch({ subscribed: true })).toEqual({ subscribed: true })
  })

  it("widens singleton literal defaults but preserves explicit unions", () => {
    const view = state({
      attempt: 0 as const,
      name: "" as const,
      status: "idle" as "idle" | "saving",
      tags: ["admin" as "admin" | "editor"]
    })

    if (false) {
      view.patch({ attempt: 1 })
      view.patch({ name: "Ada" })
      view.patch({ status: "saving" })
      view.patch({ tags: ["editor"] })
      // @ts-expect-error Explicit string unions stay narrow.
      view.patch({ status: "done" })
      // @ts-expect-error Explicit array item unions stay narrow.
      view.patch({ tags: ["guest"] })
    }

    expect(view.patch({ status: "saving", tags: ["editor"] })).toEqual({
      status: "saving",
      tags: ["editor"]
    })
  })

  it("resets defaults with optional nested overrides", () => {
    const form = state({ name: "", email: "", errors: { name: "", email: "" } })

    expect(form.reset()).toEqual({ name: "", email: "", errors: { name: "", email: "" } })
    expect(form.reset({ errors: { email: "Enter a valid email" } })).toEqual({
      name: "",
      email: "",
      errors: { name: "", email: "Enter a valid email" }
    })
  })

  it("throws early for invalid state keys", () => {
    expect(() => state({ "bad-key": "" })).toThrow(SignalNameError)
    expect(() => state({ "bad-key": {} })).toThrow(SignalNameError)
    expect(() => state({ "errors.name": "" })).toThrow(SignalNameError)
    expect(() => state({ errors: { "field.email": "" } })).toThrow(SignalNameError)
  })
})
