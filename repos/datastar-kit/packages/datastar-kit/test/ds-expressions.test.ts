import { describe, expect, it } from "vitest"
import {
  action,
  ActionNameError,
  js,
  peek,
  regex,
  RegexExpressionError,
  setAll,
  signal,
  toggleAll
} from "../src/ds/index.js"
import type { DatastarFunction } from "../src/ds/index.js"

describe("expression escape hatches", () => {
  it("keeps simple signal refs typed", () => {
    const saving = signal<boolean>("saving")

    expect(saving.toDatastarExpression()).toBe("$saving")
  })

  it("uses explicit Datastar expressions instead of a framework expression DSL", () => {
    expect(js("!($saving)").toDatastarExpression()).toBe("!($saving)")
    expect(js("($ready) && ($dirty)").toDatastarExpression()).toBe("($ready) && ($dirty)")
    expect(js('($enabled ? "Enabled" : "Disabled")').toDatastarExpression()).toBe(
      '($enabled ? "Enabled" : "Disabled")'
    )
  })

  it("interpolates Datastar expressions with signals and JS literals", () => {
    const count = signal<number>("count")

    expect(js`${count} >= ${10}`.toDatastarExpression()).toBe("$count >= 10")
    expect(js`${count} === ${"done"}`.toDatastarExpression()).toBe('$count === "done"')
    expect(js`${count} = ${0}`.toDatastarExpression()).toBe("$count = 0")
  })

  it("serializes structured JavaScript literals recursively", () => {
    const count = signal<number>("count")

    expect(
      js`${{ count, flags: ["open", false, undefined], meta: { removed: null } }}`.toDatastarExpression()
    ).toBe('{"count": $count, "flags": ["open", false, undefined], "meta": {"removed": null}}')
  })

  it("builds regular expressions without caller-managed literal escaping", () => {
    expect(regex("a/b", "i").toDatastarExpression()).toBe('new RegExp("a/b", "i")')
    expect(js`${/a\/b/i}`.toDatastarExpression()).toBe('new RegExp("a\\\\/b", "i")')
    expect(() => regex("[")).toThrow(RegexExpressionError)
  })

  it("builds Datastar built-in action expressions", () => {
    expect(peek(js<DatastarFunction<number>>("() => $count")).toDatastarExpression()).toBe(
      "@peek(() => $count)"
    )
    expect(setAll(true, { include: /^foo$/, exclude: /_temp$/ }).toDatastarExpression()).toBe(
      '@setAll(true, {"include": new RegExp("^foo$", ""), "exclude": new RegExp("_temp$", "")})'
    )
    expect(toggleAll({ include: /^is/ }).toDatastarExpression()).toBe(
      '@toggleAll({"include": new RegExp("^is", "")})'
    )
  })

  it("builds custom action expressions", () => {
    const modalOpen = signal<boolean>("modalOpen")

    expect(action("setSignal", "modalOpen", true).toDatastarExpression()).toBe(
      '@setSignal("modalOpen", true)'
    )
    expect(action("syncDialog", modalOpen).toDatastarExpression()).toBe("@syncDialog($modalOpen)")
  })

  it("rejects custom action names Datastar cannot call", () => {
    expect(() => action("bad-action")).toThrow(ActionNameError)
  })
})
