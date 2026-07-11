import { describe, expect, it } from "vitest"
import { get, js, mod, signal, type DatastarAttributes } from "../src/ds/index.js"
import { renderToString } from "../src/html.js"

const typecheckOnly = (testCases: () => void): void => {
  void testCases
}

describe("typed JSX intrinsic elements", () => {
  it("renders typed HTML attributes", () => {
    const node = (
      <form
        method="post"
        enctype="multipart/form-data"
        novalidate
      >
        <label htmlFor="avatar">Avatar</label>
        <input
          id="avatar"
          type="file"
          accept="image/*"
          required
        />
        <button
          type="submit"
          disabled={false}
        >
          Upload
        </button>
      </form>
    )

    expect(renderToString(node)).toBe(
      '<form method="post" enctype="multipart/form-data" novalidate>' +
        '<label for="avatar">Avatar</label>' +
        '<input id="avatar" type="file" accept="image/*" required>' +
        '<button type="submit">Upload</button></form>'
    )
  })

  it("renders typed Datastar attributes", () => {
    const query = signal<string, "query">("query")

    const node = (
      <input
        type="search"
        data-bind={query}
        data-on:input={mod(get("/search"), { debounce: "300ms" })}
        data-attr:aria-busy={js`${query}.length > 0`}
      />
    )

    expect(renderToString(node)).toBe(
      '<input type="search" data-bind="query" data-on:input__debounce.300ms="@get(&quot;/search&quot;)" data-attr:aria-busy="$query.length &gt; 0">'
    )
  })

  it("renders unknown tags and attributes through the escape hatches", () => {
    const ready = signal<boolean, "ready">("ready")

    const nodes = [
      <div
        unknownattr="x"
        hx-get="/fragment"
        x-data="{ open: false }"
      />,
      <my-widget
        theme="dark"
        data-on:widget-loaded={js`${ready} = true`}
        data-rows={3}
        aria-roledescription="widget"
      >
        <svg
          viewBox="0 0 10 10"
          fill="none"
        >
          <circle
            cx={5}
            cy={5}
            r={4}
            data-show={ready}
          />
        </svg>
      </my-widget>
    ]

    expect(renderToString(nodes)).toBe(
      '<div unknownattr="x" hx-get="/fragment" x-data="{ open: false }"></div>' +
        '<my-widget theme="dark" data-on:widget-loaded="$ready = true" data-rows="3" aria-roledescription="widget">' +
        '<svg viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" data-show="$ready"></circle></svg>' +
        "</my-widget>"
    )
  })

  it("rejects mistyped attribute values at compile time", () => {
    const nodes = [
      <a
        // @ts-expect-error href must be a string
        href={42}
      />,
      <button
        // @ts-expect-error type must be a button type keyword
        type="anchor"
      />,
      // @ts-expect-error data-show does not accept regular expressions
      <div data-show={/pattern/} />,
      // @ts-expect-error data-bind expects a signal reference or name
      <input data-bind={42} />,
      // @ts-expect-error data-on values must be expressions, not objects
      <div data-on:click={{ handler: true }} />,
      // @ts-expect-error void elements accept no children
      <input type="text">text</input>
    ]

    expect(nodes).toHaveLength(6)
  })

  it("renders per-attribute modifier combinations the runtime accepts", () => {
    const node = (
      <form
        data-signals={mod({ count: 0 }, { ifMissing: true })}
        data-on:submit={mod(get("/search"), { prevent: true })}
      >
        <input data-bind={mod("accepted", { prop: "checked", event: "change" })} />
      </form>
    )

    expect(renderToString(node)).toBe(
      '<form data-signals__ifmissing="{&quot;count&quot;: 0}" data-on:submit__prevent="@get(&quot;/search&quot;)">' +
        '<input data-bind__prop.checked__event.change="accepted"></form>'
    )
  })

  it("rejects incompatible modifier combinations at compile time", () => {
    typecheckOnly(() => {
      const nodes = [
        // @ts-expect-error unknown modifier keys are rejected by mod()
        <button data-on:click={mod(get("/save"), { prevent: true, nope: true })} />,
        // @ts-expect-error data-signals does not accept the prevent modifier
        <form data-signals={mod({ count: 0 }, { prevent: true })} />,
        // @ts-expect-error data-on events do not accept the ifMissing modifier
        <button data-on:click={mod(get("/save"), { ifMissing: true })} />,
        // @ts-expect-error data-bind does not accept timing modifiers
        <input data-bind={mod("accepted", { debounce: "200ms" })} />,
        // @ts-expect-error data-ignore only accepts the self modifier
        <div data-ignore={mod({ prevent: true })} />,
        // @ts-expect-error data-init does not accept event modifiers
        <div data-init={mod("$count = 1", { debounce: "500ms" })} />,
        // @ts-expect-error data-on-signal-patch does not accept viewTransition
        <div data-on-signal-patch={mod("console.log(patch)", { viewTransition: true })} />
      ]
      const customEventAttrs: DatastarAttributes = {
        // @ts-expect-error custom data-on events do not accept the ifMissing modifier
        "data-on:widget-loaded": mod(get("/save"), { ifMissing: true })
      }

      void nodes
      void customEventAttrs
    })

    expect(true).toBe(true)
  })
})
