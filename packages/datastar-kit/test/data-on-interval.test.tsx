import { describe, expect, it } from "vitest"
import { js, mod, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-on-interval", () => {
  it("renders interval expressions with the hyperscript factory", () => {
    const node = h("div", { "data-on-interval": "$count++" })

    expect(renderToString(node)).toBe('<div data-on-interval="$count++"></div>')
  })

  it("renders JSX values from signal refs and expression helpers", () => {
    const count = signal<number>("count")

    const node = <div data-on-interval={js`${count}++`}></div>

    expect(renderToString(node)).toBe('<div data-on-interval="$count++"></div>')
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-on-interval="$count++"></div>

    expect(renderToString(node)).toBe('<div data-on-interval="$count++"></div>')
  })

  it("preserves the el expression variable", () => {
    const node = (
      <div
        id="ticker"
        data-on-interval="$lastTicked = el.id"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div id="ticker" data-on-interval="$lastTicked = el.id"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <div data-on-interval></div>
        <div data-on-interval={false}></div>
        <div data-on-interval={0}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-interval="true"></div><div data-on-interval="false"></div><div data-on-interval="0"></div></div>'
    )
  })

  it("renders duration modifiers from number, numeric string, and duration string forms", () => {
    const expr = js("$count++")

    const node = (
      <div>
        <div data-on-interval={mod(expr, { duration: 500 })}></div>
        <div data-on-interval={mod(expr, { duration: "500" })}></div>
        <div data-on-interval={mod(expr, { duration: "1s" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on-interval__duration.500ms="$count++"></div><div data-on-interval__duration.500ms="$count++"></div><div data-on-interval__duration.1s="$count++"></div></div>'
    )
  })

  it("renders leading and view transition modifiers", () => {
    const node = (
      <div
        data-on-interval={mod(js("$count++"), {
          duration: "500ms",
          leading: true,
          viewTransition: true
        })}
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-on-interval__duration.500ms.leading__viewtransition="$count++"></div>'
    )
  })

  it("renders normal hand-written modifier syntax through JSX", () => {
    const node = <div {...{ "data-on-interval__duration.500ms": "$count++" }}></div>

    expect(renderToString(node)).toBe('<div data-on-interval__duration.500ms="$count++"></div>')
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <div
        data-signals:count="0"
        data-on-interval="$count++"
        data-text="$count"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:count="0" data-on-interval="$count++" data-text="$count"></div>'
    )
  })

  it("rejects explicit modifiers that data-on-interval does not support", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-on-interval": mod(js("$count++"), { delay: "500ms" })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "delay" is not valid on "data-on-interval"')
  })
})
