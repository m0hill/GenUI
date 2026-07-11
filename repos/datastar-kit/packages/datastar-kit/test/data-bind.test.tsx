import { describe, expect, it } from "vitest"
import { mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-bind", () => {
  it("renders keyed presence form with the hyperscript factory", () => {
    const node = h("input", { "data-bind:foo": true })

    expect(renderToString(node)).toBe("<input data-bind:foo>")
  })

  it("renders value form with the hyperscript factory", () => {
    const node = h("input", { "data-bind": "foo" })

    expect(renderToString(node)).toBe('<input data-bind="foo">')
  })

  it("renders keyed JSX presence form and keeps the initial element value", () => {
    const node = (
      <input
        data-bind:foo-bar
        value="baz"
      />
    )

    expect(renderToString(node)).toBe('<input data-bind:foo-bar value="baz">')
  })

  it("renders JSX value form from plain signal names", () => {
    const node = <input data-bind="fooBar" />

    expect(renderToString(node)).toBe('<input data-bind="fooBar">')
  })

  it("renders Signal refs as signal names for value form", () => {
    const fooBar = signal<string, "fooBar">("fooBar")

    const node = <input data-bind={fooBar} />

    expect(renderToString(node)).toBe('<input data-bind="fooBar">')
  })

  it("renders false keyed JSX bind props as omitted presence attributes", () => {
    const node = (
      <div>
        <input data-bind:enabled />
        <input data-bind:disabled={false} />
      </div>
    )

    expect(renderToString(node)).toBe("<div><input data-bind:enabled><input></div>")
  })

  it("renders key case modifiers for signal-name casing", () => {
    const node = (
      <div>
        <input data-bind:foo-bar={mod({ case: "camel" })} />
        <input data-bind:foo-bar={mod({ case: "snake" })} />
        <input data-bind:foo-bar={mod({ case: "kebab" })} />
        <input data-bind:foo-bar={mod({ case: "pascal" })} />
      </div>
    )

    expect(renderToString(node)).toBe(
      "<div><input data-bind:foo-bar__case.camel><input data-bind:foo-bar__case.snake><input data-bind:foo-bar__case.kebab><input data-bind:foo-bar__case.pascal></div>"
    )
  })

  it("renders prop and event modifiers for exact value form", () => {
    const accepted = signal<boolean, "accepted">("accepted")

    const node = (
      <input
        type="checkbox"
        data-bind={mod(accepted, { prop: "checked", event: ["input", "change"] })}
      />
    )

    expect(renderToString(node)).toBe(
      '<input type="checkbox" data-bind__prop.checked__event.input.change="accepted">'
    )
  })

  it("renders prop and event modifiers for keyed custom elements", () => {
    const node = <my-toggle data-bind:is-checked={mod({ prop: "checked", event: "change" })} />

    expect(renderToString(node)).toBe(
      "<my-toggle data-bind:is-checked__prop.checked__event.change></my-toggle>"
    )
  })

  it("renders normal hand-written Datastar modifier syntax through JSX", () => {
    const node = (
      <div
        {...{
          "data-bind:is-checked__prop.checked__event.change": true,
          "data-bind:foo-bar__case.snake": true
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      "<div data-bind:is-checked__prop.checked__event.change data-bind:foo-bar__case.snake></div>"
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <input
        data-signals:foo-bar="'fizz'"
        data-bind:foo-bar
        value="baz"
      />
    )

    expect(renderToString(node)).toBe(
      '<input data-signals:foo-bar="&#39;fizz&#39;" data-bind:foo-bar value="baz">'
    )
  })

  it("supports binding scenarios from the docs as renderable markup", () => {
    const node = (
      <div data-signals:foo-bar="[]">
        <input
          data-bind:foo-bar
          type="checkbox"
          value="fizz"
        />
        <input
          data-bind:foo-bar
          type="checkbox"
          value="baz"
        />
        <input
          type="file"
          data-bind:files
          multiple
        />
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:foo-bar="[]"><input data-bind:foo-bar type="checkbox" value="fizz"><input data-bind:foo-bar type="checkbox" value="baz"><input type="file" data-bind:files multiple></div>'
    )
  })

  it("rejects explicit modifiers that data-bind does not support", () => {
    expect(() =>
      runtimeJsx("input", {
        "data-bind": mod("foo", { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-bind"')
  })

  it("rejects case modifiers on unkeyed data-bind because upstream only applies case to keys", () => {
    expect(() =>
      runtimeJsx("input", {
        "data-bind": mod(signal<string>("fooBar"), { case: "kebab" })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "case" is not valid on "data-bind"')
  })
})
