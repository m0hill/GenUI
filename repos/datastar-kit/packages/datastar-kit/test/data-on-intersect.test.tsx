import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-on-intersect", () => {
  it("renders intersect expressions with the hyperscript factory", () => {
    const node = h("div", { "data-on-intersect": "$intersected = true" })

    expect(renderToString(node)).toBe('<div data-on-intersect="$intersected = true"></div>')
  })

  it("renders JSX values from signal refs and expression helpers", () => {
    const intersected = signal<boolean>("intersected")

    const node = <div data-on-intersect={js`${intersected} = ${true}`}></div>

    expect(renderToString(node)).toBe('<div data-on-intersect="$intersected = true"></div>')
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-on-intersect="$intersected = true"></div>

    expect(renderToString(node)).toBe('<div data-on-intersect="$intersected = true"></div>')
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="sentinel"
        data-on-intersect="$lastSeen = el.id"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div id="sentinel" data-on-intersect="$lastSeen = el.id"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <div data-on-intersect></div>
        <div data-on-intersect={false}></div>
        <div data-on-intersect={0}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-intersect="true"></div><div data-on-intersect="false"></div><div data-on-intersect="0"></div></div>'
    )
  })

  it("renders visibility behavior modifiers", () => {
    const expr = js("$intersected = true")

    const node = (
      <div>
        <div data-on-intersect={mod(expr, { once: true, full: true })}></div>
        <div data-on-intersect={mod(expr, { exit: true, half: true })}></div>
        <div data-on-intersect={mod(expr, { threshold: 25 })}></div>
        <div data-on-intersect={mod(expr, { threshold: "75" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-intersect__once__full="$intersected = true"></div><div data-on-intersect__exit__half="$intersected = true"></div><div data-on-intersect__threshold.25="$intersected = true"></div><div data-on-intersect__threshold.75="$intersected = true"></div></div>'
    )
  })

  it("renders timing and view transition modifiers", () => {
    const expr = js("$intersected = true")

    const node = (
      <div>
        <div data-on-intersect={mod(expr, { delay: "500ms" })}></div>
        <div
          data-on-intersect={mod(expr, {
            debounce: { duration: "1s", leading: true, noTrailing: true }
          })}
        ></div>
        <div
          data-on-intersect={mod(expr, {
            throttle: { duration: 250, noLeading: true, trailing: true }
          })}
        ></div>
        <div data-on-intersect={mod(expr, { viewTransition: true })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-intersect__delay.500ms="$intersected = true"></div><div data-on-intersect__debounce.1s.leading.notrailing="$intersected = true"></div><div data-on-intersect__throttle.250ms.noleading.trailing="$intersected = true"></div><div data-on-intersect__viewtransition="$intersected = true"></div></div>'
    )
  })

  it("renders normal hand-written modifier syntax through JSX", () => {
    const node = <div {...{ "data-on-intersect__once__full": "$fullyIntersected = true" }}></div>

    expect(renderToString(node)).toBe(
      '<div data-on-intersect__once__full="$fullyIntersected = true"></div>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:intersected="false"
        data-on-intersect="$intersected = true"
        data-text="$intersected"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:intersected="false" data-on-intersect="$intersected = true" data-text="$intersected"></div>'
    )
  })

  it("rejects explicit modifiers that data-on-intersect does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-on-intersect": mod(js("$intersected = true"), { capture: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "capture" is not valid on "data-on-intersect"')
  })
})
