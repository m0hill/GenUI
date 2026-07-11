import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-on-signal-patch", () => {
  it("renders signal-patch expressions with the hyperscript factory", () => {
    const node = h("div", { "data-on-signal-patch": "console.log('A signal changed!')" })

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch="console.log(&#39;A signal changed!&#39;)"></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-on-signal-patch="console.log('Signal patch:', patch)"></div>

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch="console.log(&#39;Signal patch:&#39;, patch)"></div>'
    )
  })

  it("renders JSX values from signal refs and expression helpers", () => {
    const changed = signal<boolean>("changed")

    const node = (
      <div data-on-signal-patch={js`${changed} = Object.keys(patch).length > ${0}`}></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch="$changed = Object.keys(patch).length &gt; 0"></div>'
    )
  })

  it("preserves the patch and el expression variables", () => {
    const node = (
      <div
        id="watcher"
        data-on-signal-patch="console.log(el.id, patch)"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div id="watcher" data-on-signal-patch="console.log(el.id, patch)"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <div data-on-signal-patch></div>
        <div data-on-signal-patch={false}></div>
        <div data-on-signal-patch={0}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-signal-patch="true"></div><div data-on-signal-patch="false"></div><div data-on-signal-patch="0"></div></div>'
    )
  })

  it("renders timing modifiers", () => {
    const expr = js("console.log(patch)")

    const node = (
      <div>
        <div data-on-signal-patch={mod(expr, { delay: "500ms" })}></div>
        <div
          data-on-signal-patch={mod(expr, {
            debounce: { duration: "1s", leading: true, noTrailing: true }
          })}
        ></div>
        <div
          data-on-signal-patch={mod(expr, {
            throttle: { duration: 250, noLeading: true, trailing: true }
          })}
        ></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-signal-patch__delay.500ms="console.log(patch)"></div><div data-on-signal-patch__debounce.1s.leading.notrailing="console.log(patch)"></div><div data-on-signal-patch__throttle.250ms.noleading.trailing="console.log(patch)"></div></div>'
    )
  })

  it("renders normal hand-written modifier syntax through JSX", () => {
    const node = <div {...{ "data-on-signal-patch__debounce.500ms": "doSomething()" }}></div>

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch__debounce.500ms="doSomething()"></div>'
    )
  })

  it("renders the companion filter attribute with data-on-signal-patch", () => {
    const node = (
      <div
        data-on-signal-patch-filter="{include: /^counter$/}"
        data-on-signal-patch="console.log(patch)"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-signal-patch-filter="{include: /^counter$/}" data-on-signal-patch="console.log(patch)"></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:changed="false"
        data-on-signal-patch="$changed = true"
        data-text="$changed"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:changed="false" data-on-signal-patch="$changed = true" data-text="$changed"></div>'
    )
  })

  it("rejects explicit modifiers that data-on-signal-patch does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-on-signal-patch": mod(js("console.log(patch)"), { viewTransition: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "viewTransition" is not valid on "data-on-signal-patch"')
  })
})
