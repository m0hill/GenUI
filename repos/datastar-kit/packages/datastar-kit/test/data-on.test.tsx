import { describe, expect, it } from "vitest"
import { js, mod, post, signal } from "../src/ds/index.js"
import { h, renderToString } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("data-on", () => {
  it("renders event listener expressions with the hyperscript factory", () => {
    const node = h("button", { "data-on:click": "$foo = ''" }, "Reset")

    expect(renderToString(node)).toBe('<button data-on:click="$foo = &#39;&#39;">Reset</button>')
  })

  it("renders JSX values from actions, signal refs, and expression helpers", () => {
    const foo = signal<string>("foo")

    const node = (
      <div>
        <button data-on:click={js`${foo} = ${""}`}>Reset</button>
        <form data-on:submit={post("/submit")}></form>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-on:click="$foo = &quot;&quot;">Reset</button><form data-on:submit="@post(&quot;/submit&quot;)"></form></div>'
    )
  })

  it("keeps string JSX values as raw Datastar expressions", () => {
    const node = <div data-on:my-event="$foo = evt.detail"></div>

    expect(renderToString(node)).toBe('<div data-on:my-event="$foo = evt.detail"></div>')
  })

  it("preserves the evt and el expression variables", () => {
    const node = (
      <div
        id="receiver"
        data-on:my-event="$foo = el.id + ':' + evt.detail"
      ></div>
    )

    expect(renderToString(node)).toBe(
      '<div id="receiver" data-on:my-event="$foo = el.id + &#39;:&#39; + evt.detail"></div>'
    )
  })

  it("serializes primitive expression values without omitting falsey values", () => {
    const node = (
      <div>
        <button data-on:click></button>
        <button data-on:click={false}></button>
        <button data-on:click={0}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-on:click="true"></button><button data-on:click="false"></button><button data-on:click="0"></button></div>'
    )
  })

  it("renders built-in event listener option modifiers", () => {
    const node = (
      <button
        data-on:click={mod(js("$clicked = true"), { once: true, passive: true, capture: true })}
      ></button>
    )

    expect(renderToString(node)).toBe(
      '<button data-on:click__once__passive__capture="$clicked = true"></button>'
    )
  })

  it("renders event case modifiers", () => {
    const expr = js("$foo = ''")

    const node = (
      <div>
        <div data-on:my-event={mod(expr, { case: "camel" })}></div>
        <div data-on:my-event={mod(expr, { case: "snake" })}></div>
        <div data-on:my-event={mod(expr, { case: "kebab" })}></div>
        <div data-on:my-event={mod(expr, { case: "pascal" })}></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-on:my-event__case.camel="$foo = &#39;&#39;"></div><div data-on:my-event__case.snake="$foo = &#39;&#39;"></div><div data-on:my-event__case.kebab="$foo = &#39;&#39;"></div><div data-on:my-event__case.pascal="$foo = &#39;&#39;"></div></div>'
    )
  })

  it("renders timing and view transition modifiers", () => {
    const expr = js("$foo = ''")

    const node = (
      <div>
        <button data-on:click={mod(expr, { delay: "500ms" })}></button>
        <button
          data-on:click={mod(expr, {
            debounce: { duration: "1s", leading: true, noTrailing: true }
          })}
        ></button>
        <button
          data-on:click={mod(expr, {
            throttle: { duration: 250, noLeading: true, trailing: true }
          })}
        ></button>
        <button data-on:click={mod(expr, { viewTransition: true })}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-on:click__delay.500ms="$foo = &#39;&#39;"></button><button data-on:click__debounce.1s.leading.notrailing="$foo = &#39;&#39;"></button><button data-on:click__throttle.250ms.noleading.trailing="$foo = &#39;&#39;"></button><button data-on:click__viewtransition="$foo = &#39;&#39;"></button></div>'
    )
  })

  it("renders event target and event side-effect modifiers", () => {
    const expr = js("$foo = ''")

    const node = (
      <div>
        <button data-on:resize={mod(expr, { window: true })}></button>
        <button data-on:visibility-change={mod(expr, { document: true })}></button>
        <button data-on:click={mod(expr, { outside: true })}></button>
        <button data-on:click={mod(expr, { prevent: true, stop: true })}></button>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><button data-on:resize__window="$foo = &#39;&#39;"></button><button data-on:visibility-change__document="$foo = &#39;&#39;"></button><button data-on:click__outside="$foo = &#39;&#39;"></button><button data-on:click__prevent__stop="$foo = &#39;&#39;"></button></div>'
    )
  })

  it("renders normal hand-written modifier syntax through JSX", () => {
    const node = (
      <button {...{ "data-on:click__window__debounce.500ms.leading": "$foo = ''" }}></button>
    )

    expect(renderToString(node)).toBe(
      '<button data-on:click__window__debounce.500ms.leading="$foo = &#39;&#39;"></button>'
    )
  })

  it("preserves authored attribute order for Datastar evaluation ordering", () => {
    const node = (
      <form
        data-indicator:fetching
        data-on:submit={mod(post("/submit"), { prevent: true })}
        data-attr:disabled="$fetching"
      ></form>
    )

    expect(renderToString(node)).toBe(
      '<form data-indicator:fetching data-on:submit__prevent="@post(&quot;/submit&quot;)" data-attr:disabled="$fetching"></form>'
    )
  })

  it("rejects explicit modifiers that data-on does not support", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-on:click": mod(js("$foo = ''"), { prop: "value" })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prop" is not valid on "data-on:click"')
  })

  it("rejects explicit modifiers on unkeyed data-on because event names are required", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-on": mod(js("$foo = ''"), { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar attribute "data-on" does not accept modifiers')
  })
})
