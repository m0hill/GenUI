import { describe, expect, it } from "vitest"
import { js, local, mod, state } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-signals", () => {
  it("renders keyed signal patches with the hyperscript factory", () => {
    const node = h("div", { "data-signals:foo": "1" })

    expect(renderToString(node)).toBe('<div data-signals:foo="1"></div>')
  })

  it("renders nested keyed signal patches with dot notation", () => {
    const node = h("div", { "data-signals:foo.bar": "1" })

    expect(renderToString(node)).toBe('<div data-signals:foo.bar="1"></div>')
  })

  it("renders raw object expressions with the hyperscript factory", () => {
    const node = h("div", { "data-signals": "{foo: {bar: 1, baz: 2}}" })

    expect(renderToString(node)).toBe('<div data-signals="{foo: {bar: 1, baz: 2}}"></div>')
  })

  it("renders JSX values from signals, local signals, state helpers, and expression helpers", () => {
    const form = state({ name: "", errors: { name: "" } })
    const saving = local<boolean>("saving")

    const node = (
      <div
        data-signals={form.defaults}
        data-signals:_saving={false}
        data-signals:next-name={js`${form.refs.name} + ${"!"}`}
        data-text={saving}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals="{&quot;name&quot;: &quot;&quot;, &quot;errors&quot;: {&quot;name&quot;: &quot;&quot;}}" data-signals:_saving="false" data-signals:next-name="$name + &quot;!&quot;" data-text="$_saving"></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = (
      <div
        data-signals:foo="1"
        data-signals="{foo: {bar: 1, baz: 2}}"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:foo="1" data-signals="{foo: {bar: 1, baz: 2}}"></div>'
    )
  })

  it("serializes object syntax including null and undefined removals", () => {
    const node = (
      <div
        data-signals={{
          foo: { bar: 1, baz: 2 },
          removeWithNull: null,
          removeWithUndefined: undefined
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals="{&quot;foo&quot;: {&quot;bar&quot;: 1, &quot;baz&quot;: 2}, &quot;removeWithNull&quot;: null, &quot;removeWithUndefined&quot;: undefined}"></div>'
    )
  })

  it("serializes keyed primitive values without treating booleans as presence attributes", () => {
    const node = (
      <div>
        <div data-signals:enabled></div>
        <div data-signals:disabled={false}></div>
        <div data-signals:count={0}></div>
        <div data-signals:empty=""></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-signals:enabled="true"></div><div data-signals:disabled="false"></div><div data-signals:count="0"></div><div data-signals:empty=""></div></div>'
    )
  })

  it("renders ifmissing modifiers for exact and keyed forms", () => {
    const node = (
      <div>
        <div data-signals={mod({ foo: 1 }, { ifMissing: true })}></div>
        <div data-signals:foo={mod(1, { ifMissing: true })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-signals__ifmissing="{&quot;foo&quot;: 1}"></div><div data-signals:foo__ifmissing="1"></div></div>'
    )
  })

  it("renders case modifiers for keyed signal names", () => {
    const node = (
      <div>
        <div data-signals:my-signal={mod(1, { case: "camel" })}></div>
        <div data-signals:my-signal={mod(1, { case: "snake" })}></div>
        <div data-signals:my-signal={mod(1, { case: "kebab" })}></div>
        <div data-signals:my-signal={mod(1, { case: "pascal" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-signals:my-signal__case.camel="1"></div><div data-signals:my-signal__case.snake="1"></div><div data-signals:my-signal__case.kebab="1"></div><div data-signals:my-signal__case.pascal="1"></div></div>'
    )
  })

  it("renders normal hand-written modifier syntax through JSX", () => {
    const node = (
      <div
        {...{
          "data-signals:my-signal__case.kebab": "1",
          "data-signals:foo__ifmissing": "1"
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:my-signal__case.kebab="1" data-signals:foo__ifmissing="1"></div>'
    )
  })

  it("preserves authored attribute order so later DOM definitions can override earlier ones", () => {
    const node = (
      <div>
        <div data-signals:foo="1"></div>
        <div data-signals:foo="2"></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-signals:foo="1"></div><div data-signals:foo="2"></div></div>'
    )
  })

  it("rejects explicit modifiers that data-signals does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-signals:foo": mod(1, { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-signals:foo"')
  })

  it("rejects case modifiers on unkeyed data-signals because upstream only applies case to keys", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-signals": mod({ mySignal: 1 }, { case: "kebab" })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "case" is not valid on "data-signals"')
  })
})
