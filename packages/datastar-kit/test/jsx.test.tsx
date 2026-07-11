import { describe, expect, it } from "vitest"
import { mod, post, preserve, signal, state } from "../src/ds/index.js"
import { renderToString, type HtmlChild } from "../src/html.js"
import type { JsxProps } from "../src/jsx.js"
import { jsxDEV as runtimeJsxDev } from "../src/jsx-dev-runtime.js"
import { jsx as runtimeJsx } from "../src/jsx-runtime.js"

describe("automatic JSX runtime", () => {
  it("renders JSX through the same HTML renderer", () => {
    const node = (
      <button
        type="button"
        disabled
      >
        Save
      </button>
    )

    expect(renderToString(node)).toBe('<button type="button" disabled>Save</button>')
  })

  it("renders Datastar signal refs and actions directly on data attributes", () => {
    const login = state({
      password: "",
      _validation: { password: "" }
    })

    const node = (
      <form
        data-signals={mod({ password: "", _validation: { password: "" } }, { ifMissing: true })}
        data-on:submit={mod(post("/login"), { prevent: true })}
      >
        <input
          type="password"
          data-bind={login.refs.password}
        />
        <small
          data-show={login.refs._validation.password}
          data-text={login.refs._validation.password}
        ></small>
      </form>
    )

    expect(renderToString(node)).toBe(
      '<form data-signals__ifmissing="{&quot;password&quot;: &quot;&quot;, &quot;_validation&quot;: {&quot;password&quot;: &quot;&quot;}}" data-on:submit__prevent="@post(&quot;/login&quot;)"><input type="password" data-bind="password"><small data-show="$_validation.password" data-text="$_validation.password"></small></form>'
    )
  })

  it("renders signal-name Datastar attributes without the expression prefix", () => {
    const fetching = signal<boolean, "_fetching">("_fetching")
    const panel = signal<HTMLElement, "panel">("panel")

    const node = (
      <button
        data-indicator={fetching}
        data-ref={panel}
      >
        Save
      </button>
    )

    expect(renderToString(node)).toBe(
      '<button data-indicator="_fetching" data-ref="panel">Save</button>'
    )
  })

  it("serializes primitive values for expression-valued Datastar attributes", () => {
    const node = (
      <div
        data-signals:_saving={mod(false, { ifMissing: true })}
        data-attr:disabled={false}
        data-show={false}
        data-ignore
      />
    )

    expect(renderToString(node)).toBe(
      '<div data-signals:_saving__ifmissing="false" data-attr:disabled="false" data-show="false" data-ignore></div>'
    )
  })

  it("renders explicit modifier wrappers as Datastar attribute suffixes", () => {
    const node = (
      <input
        type="search"
        data-on:input={mod(post("/search"), { debounce: "200ms" })}
      />
    )

    expect(renderToString(node)).toBe(
      '<input type="search" data-on:input__debounce.200ms="@post(&quot;/search&quot;)">'
    )
  })

  it("renders structured timing modifiers from explicit modifier wrappers", () => {
    const node = (
      <button
        type="button"
        data-on:click={mod(post("/save"), {
          window: true,
          debounce: { duration: "500ms", leading: true }
        })}
      >
        Save
      </button>
    )

    expect(renderToString(node)).toBe(
      '<button type="button" data-on:click__window__debounce.500ms.leading="@post(&quot;/save&quot;)">Save</button>'
    )
  })

  it("renders bind event and prop modifiers", () => {
    const node = (
      <input data-bind={mod("accepted", { prop: "checked", event: ["input", "change"] })} />
    )

    expect(renderToString(node)).toBe(
      '<input data-bind__prop.checked__event.input.change="accepted">'
    )
  })

  it("renders case modifiers for keyed event names", () => {
    const node = (
      <button data-on:widget-loaded={mod(post("/widgets"), { case: "camel" })}>Sync</button>
    )

    expect(renderToString(node)).toBe(
      '<button data-on:widget-loaded__case.camel="@post(&quot;/widgets&quot;)">Sync</button>'
    )
  })

  it("renders ignore self modifiers", () => {
    const node = <div data-ignore={mod({ self: true })}></div>

    expect(renderToString(node)).toBe("<div data-ignore__self></div>")
  })

  it("renders interval duration tags and view transition modifiers", () => {
    const node = (
      <div
        data-on-interval={mod("$count++", {
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

  it("keeps string Datastar attribute values raw", () => {
    const node = (
      <button
        data-on:click="@post('/save')"
        data-text="$message"
      >
        Save
      </button>
    )

    expect(renderToString(node)).toBe(
      '<button data-on:click="@post(&#39;/save&#39;)" data-text="$message">Save</button>'
    )
  })

  it("keeps wrapped string Datastar values raw", () => {
    const node = <button data-on:click={mod("@post('/save')", { prevent: true })}>Save</button>

    expect(renderToString(node)).toBe(
      '<button data-on:click__prevent="@post(&#39;/save&#39;)">Save</button>'
    )
  })

  it("keeps ordinary arrays as Datastar values", () => {
    const node = <div data-signals:items={["a", { id: 1 }]}></div>

    expect(renderToString(node)).toBe(
      '<div data-signals:items="[&quot;a&quot;, {&quot;id&quot;: 1}]"></div>'
    )
  })

  it("serializes native regular expressions in Datastar filter objects", () => {
    const node = <pre data-json-signals={{ include: /^counter$/, exclude: /_temp$/ }}></pre>

    expect(renderToString(node)).toBe(
      '<pre data-json-signals="{&quot;include&quot;: new RegExp(&quot;^counter$&quot;, &quot;&quot;), &quot;exclude&quot;: new RegExp(&quot;_temp$&quot;, &quot;&quot;)}"></pre>'
    )
  })

  it("serializes keyed data-signals booleans as expression values", () => {
    const node = (
      <div>
        <div data-signals:enabled={true}></div>
        <div data-signals:enabled-shorthand></div>
        <div data-signals:disabled={false}></div>
        <div data-signals:empty=""></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div><div data-signals:enabled="true"></div><div data-signals:enabled-shorthand="true"></div><div data-signals:disabled="false"></div><div data-signals:empty=""></div></div>'
    )
  })

  it("rejects wrapped modifiers on incompatible Datastar attributes", () => {
    expect(() =>
      runtimeJsx("main", {
        "data-signals": mod({ ready: false }, { prevent: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "prevent" is not valid on "data-signals"')
  })

  it("rejects unknown wrapped modifier names", () => {
    expect(() =>
      runtimeJsx("button", {
        "data-on:click": mod(post("/save"), { preevent: true } as never)
      } as unknown as JsxProps)
    ).toThrow('Unknown Datastar modifier "preevent"')
  })

  it("rejects Datastar modifiers that are not listed for the attribute", () => {
    expect(() =>
      runtimeJsx("div", {
        "data-init": mod("$count = 1", { debounce: "500ms" })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "debounce" is not valid on "data-init"')

    expect(() =>
      runtimeJsx("div", {
        "data-on-signal-patch": mod("console.log(patch)", { viewTransition: true })
      } as unknown as JsxProps)
    ).toThrow('Datastar modifier "viewTransition" is not valid on "data-on-signal-patch"')
  })

  it("still rejects expression objects on ordinary JSX props", () => {
    expect(() =>
      runtimeJsx("output", { id: signal<number>("count") } as unknown as JsxProps)
    ).toThrow('Unsupported JSX prop value for "id"')
  })

  it("does not render compiler-managed JSX runtime props", () => {
    const node = runtimeJsx("button", {
      key: "save",
      __self: {},
      __source: { fileName: "fixture.tsx" },
      children: "Save"
    })

    expect(renderToString(node)).toBe("<button>Save</button>")
  })

  it("renders through the development JSX runtime entrypoint", () => {
    const node = runtimeJsxDev(
      "span",
      { className: "badge", children: "Dev" },
      undefined,
      false,
      { fileName: "fixture.tsx" },
      {}
    )

    expect(renderToString(node)).toBe('<span class="badge">Dev</span>')
  })

  it("lets an explicit class prop win over className normalization", () => {
    const node = (
      <div
        class="from-class"
        className="from-className"
      ></div>
    )

    expect(renderToString(node)).toBe('<div class="from-class"></div>')
  })

  it("renders boolean JSX props according to HTML attribute kind", () => {
    const node = (
      <div
        aria-hidden={false}
        aria-expanded
        data-enabled={false}
        data-active
        draggable={false}
        contenteditable={false}
      >
        <button
          type="button"
          disabled={false}
          autofocus
        >
          Save
        </button>
        <div
          data-ignore={false}
          data-ref:panel
        ></div>
      </div>
    )

    expect(renderToString(node)).toBe(
      '<div aria-hidden="false" aria-expanded="true" data-enabled="false" data-active="true" draggable="false" contenteditable="false"><button type="button" autofocus>Save</button><div data-ref:panel></div></div>'
    )
  })

  it("normalizes TSX className to HTML class", () => {
    const node = <div className="stack gap-2">Hello</div>

    expect(renderToString(node)).toBe('<div class="stack gap-2">Hello</div>')
  })

  it("normalizes htmlFor to the HTML for attribute", () => {
    const node = <label htmlFor="email">Email</label>

    expect(renderToString(node)).toBe('<label for="email">Email</label>')
  })

  it("renders data-preserve-attr helper output", () => {
    const node = (
      <details
        open
        data-preserve-attr={preserve("open", "class")}
      ></details>
    )

    expect(renderToString(node)).toBe('<details open data-preserve-attr="open class"></details>')
  })

  it("renders fragments for sibling nodes", () => {
    const nodes = (
      <>
        <span>A</span>
        <span>B</span>
      </>
    )

    expect(renderToString(nodes)).toBe("<span>A</span><span>B</span>")
  })

  it("supports components returning any renderable child", () => {
    const Maybe = (props: { readonly show: boolean }) => (props.show ? <span>Shown</span> : null)
    const TextOnly = () => "Plain text"
    const NumberOnly = () => 7
    const Empty = () => false

    const node = (
      <>
        <Maybe show />
        <Maybe show={false} />
        <TextOnly />
        <NumberOnly />
        <Empty />
      </>
    )

    expect(renderToString(node)).toBe("<span>Shown</span>Plain text7")
  })

  it("supports typed server components", () => {
    interface LinkProps {
      readonly href: string
      readonly children?: HtmlChild | readonly HtmlChild[]
    }

    const Link = (props: LinkProps) => <a href={props.href}>{props.children}</a>

    expect(renderToString(<Link href="/docs">Docs</Link>)).toBe('<a href="/docs">Docs</a>')
  })
})
