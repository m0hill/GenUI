import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-class", () => {
  it("renders keyed class expressions with the hyperscript factory", () => {
    const node = h("div", { "data-class:font-bold": "$foo == 'strong'" })

    expect(renderToString(node)).toBe('<div data-class:font-bold="$foo == &#39;strong&#39;"></div>')
  })

  it("renders raw multi-class object expressions with the hyperscript factory", () => {
    const node = h("div", {
      "data-class": "{success: $foo != '', 'font-bold': $foo == 'strong'}"
    })

    expect(renderToString(node)).toBe(
      '<div data-class="{success: $foo != &#39;&#39;, &#39;font-bold&#39;: $foo == &#39;strong&#39;}"></div>'
    )
  })

  it("renders keyed JSX values from signal refs and expression helpers", () => {
    const strong = signal<boolean>("strong")
    const active = signal<boolean>("active")

    const node = (
      <div
        class="base"
        data-class:font-bold={strong}
        data-class:is-active={js`${active} && el.dataset.ready === ${"yes"}`}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div class="base" data-class:font-bold="$strong" data-class:is-active="$active &amp;&amp; el.dataset.ready === &quot;yes&quot;"></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = (
      <div
        data-class:font-bold="$foo == 'strong'"
        data-class:empty="$foo == ''"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-class:font-bold="$foo == &#39;strong&#39;" data-class:empty="$foo == &#39;&#39;"></div>'
    )
  })

  it("renders normal hand-written Datastar object syntax through JSX", () => {
    const node = <div data-class="{success: $foo != '', 'font-bold': $foo == 'strong'}"></div>

    expect(renderToString(node)).toBe(
      '<div data-class="{success: $foo != &#39;&#39;, &#39;font-bold&#39;: $foo == &#39;strong&#39;}"></div>'
    )
  })

  it("serializes object syntax for multiple classes", () => {
    const success = signal<boolean>("success")
    const count = signal<number>("count")

    const node = (
      <div
        data-class={{
          success,
          "font-bold": js`${count} > ${0}`,
          "border rounded": true,
          hidden: false
        }}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-class="{&quot;success&quot;: $success, &quot;font-bold&quot;: $count &gt; 0, &quot;border rounded&quot;: true, &quot;hidden&quot;: false}"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div
        data-class:always
        data-class:never={false}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-class:always="true" data-class:never="false"></div>'
    )
  })

  it("renders case modifiers for keyed class names", () => {
    const enabled = signal<boolean>("enabled")

    const node = (
      <div>
        <span data-class:my-class={mod(enabled, { case: "camel" })}></span>
        <span data-class:my-class={mod(enabled, { case: "snake" })}></span>
        <span data-class:my-class={mod(enabled, { case: "kebab" })}></span>
        <span data-class:my-class={mod(enabled, { case: "pascal" })}></span>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><span data-class:my-class__case.camel="$enabled"></span><span data-class:my-class__case.snake="$enabled"></span><span data-class:my-class__case.kebab="$enabled"></span><span data-class:my-class__case.pascal="$enabled"></span></div>'
    )
  })

  it("renders normal hand-written case modifier syntax through JSX", () => {
    const node = <div {...{ "data-class:my-class__case.camel": "$foo" }}></div>

    expect(renderToString(node)).toBe('<div data-class:my-class__case.camel="$foo"></div>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-class:loaded="$ready"
        data-init="$ready = true"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-class:loaded="$ready" data-init="$ready = true"></div>'
    )
  })

  it("rejects explicit modifiers that data-class does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-class:font-bold": mod(signal<boolean>("strong"), { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-class:font-bold"')
  })

  it("rejects explicit modifiers on unkeyed data-class because modifiers only affect class keys", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-class": mod({ success: true }, { case: "camel" })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-class" does not accept modifiers')
  })
})
