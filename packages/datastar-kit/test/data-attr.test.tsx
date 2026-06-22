import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-attr", () => {
  it("renders keyed data-attr attributes with the hyperscript factory", () => {
    const node = h("div", { "data-attr:aria-label": "$foo" })

    expect(renderToString(node)).toBe('<div data-attr:aria-label="$foo"></div>')
  })

  it("renders raw object expressions with the hyperscript factory", () => {
    const node = h("div", {
      "data-attr": "{'aria-label': $foo, disabled: $bar, title: 'Save'}"
    })

    expect(renderToString(node)).toBe(
      '<div data-attr="{&#39;aria-label&#39;: $foo, disabled: $bar, title: &#39;Save&#39;}"></div>'
    )
  })

  it("renders keyed JSX data-attr values from signal refs and expression helpers", () => {
    const label = signal<string>("label")
    const disabled = signal<boolean>("disabled")

    const node = (
      <button
        data-attr:aria-label={label}
        data-attr:disabled={disabled}
        data-attr:title={js`${label} ?? ${"Untitled"}`}
      >
        Save
      </button>
    )

    expect(renderToString(node)).toBe(
      '<button data-attr:aria-label="$label" data-attr:disabled="$disabled" data-attr:title="$label ?? &quot;Untitled&quot;">Save</button>'
    )
  })

  it("keeps string JSX data-attr values as raw Datastar expressions", () => {
    const node = (
      <button
        data-attr:title="'Save now'"
        data-attr:aria-label="$label + ' button'"
      ></button>
    )

    expect(renderToString(node)).toBe(
      '<button data-attr:title="&#39;Save now&#39;" data-attr:aria-label="$label + &#39; button&#39;"></button>'
    )
  })

  it("renders normal hand-written Datastar data-attr strings through JSX", () => {
    const node = (
      <div
        data-attr="{'aria-label': $foo, disabled: $bar, title: el.id}"
        data-attr:aria-live="$urgent ? 'assertive' : 'polite'"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-attr="{&#39;aria-label&#39;: $foo, disabled: $bar, title: el.id}" data-attr:aria-live="$urgent ? &#39;assertive&#39; : &#39;polite&#39;"></div>'
    )
  })

  it("serializes object syntax for setting multiple target attributes", () => {
    const label = signal<string>("label")
    const busy = signal<boolean>("busy")

    const node = (
      <button
        data-attr={{
          "aria-label": label,
          disabled: busy,
          title: 'Save "now" & stay',
          "data-count": 3,
          hidden: false,
          "aria-describedby": null
        }}
      ></button>
    )

    expect(renderToString(node)).toBe(
      '<button data-attr="{&quot;aria-label&quot;: $label, &quot;disabled&quot;: $busy, &quot;title&quot;: &quot;Save \\&quot;now\\&quot; &amp; stay&quot;, &quot;data-count&quot;: 3, &quot;hidden&quot;: false, &quot;aria-describedby&quot;: null}"></button>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <fieldset
        data-attr:disabled
        data-attr:hidden={false}
        data-attr:aria-expanded={false}
        data-attr:tabindex={0}
      ></fieldset>
    )

    expect(renderToString(node)).toBe(
      '<fieldset data-attr:disabled="true" data-attr:hidden="false" data-attr:aria-expanded="false" data-attr:tabindex="0"></fieldset>'
    )
  })

  it("preserves the el expression variable in authored expressions", () => {
    const node = (
      <div
        id="panel"
        data-attr:aria-controls={js`el.id + ${"-content"}`}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div id="panel" data-attr:aria-controls="el.id + &quot;-content&quot;"></div>'
    )
  })

  it("serializes complex target values for Datastar to stringify at runtime", () => {
    const activeTag = signal<string>("activeTag")

    const node = (
      <div
        data-attr:title={js`${""}`}
        data-attr:data-payload={{ id: 1, tags: ["alpha", activeTag] }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-attr:title="&quot;&quot;" data-attr:data-payload="{&quot;id&quot;: 1, &quot;tags&quot;: [&quot;alpha&quot;, $activeTag]}"></div>'
    )
  })

  it("renders data-attr target names that are themselves Datastar attributes", () => {
    const editing = signal<boolean>("editing")

    const node = (
      <input
        type="text"
        {...{
          "data-attr:data-bind:mutation-rate": editing,
          "data-attr:data-bind:_mutation-rate": js`!${editing}`
        }}
      />
    )

    expect(renderToString(node)).toBe(
      '<input type="text" data-attr:data-bind:mutation-rate="$editing" data-attr:data-bind:_mutation-rate="!$editing">'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const busy = signal<boolean>("busy")

    const node = (
      <div
        data-attr:disabled={busy}
        data-init="@get('/boot')"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-attr:disabled="$busy" data-init="@get(&#39;/boot&#39;)"></div>'
    )
  })

  it("rejects explicit modifier wrappers because data-attr has no supported modifiers", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-attr:aria-label": mod(signal<string>("label"), { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-attr:aria-label" does not accept modifiers')
  })
})
