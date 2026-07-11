import { Script, runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { renderToString } from "../src/html.js"
import {
  DATASTAR_DEBUGGER_STATE_NAME,
  DatastarDebugger,
  type DatastarDebuggerStateName,
  datastarDebuggerDefaults
} from "../src/debugger.js"

const DEFAULT_SIGNAL_REF = `$${DATASTAR_DEBUGGER_STATE_NAME}`

type RuntimeDebuggerEvent = Record<string, unknown>
type RuntimeDebuggerState = {
  tab: "signals" | "events"
  search: string
  paused: boolean
  events: RuntimeDebuggerEvent[]
}

const decodeHtmlAttribute = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const attributeValues = (html: string, attribute: string): string[] =>
  Array.from(
    html.matchAll(new RegExp(`${escapeRegExp(attribute)}="([\\s\\S]*?)"`, "g")),
    ([, value]) => decodeHtmlAttribute(value ?? "")
  )

const attributeValue = (html: string, attribute: string): string => {
  const values = attributeValues(html, attribute)
  expect(values).toHaveLength(1)
  return values[0]!
}

const runtimeDebuggerState = (): RuntimeDebuggerState => ({
  ...datastarDebuggerDefaults(),
  events: []
})

const runExpression = (expression: string, scope: Readonly<Record<string, unknown>>): unknown =>
  runInNewContext(expression, { ...scope })

describe("Datastar debugger", () => {
  it("renders Datastar wiring with local signal state", () => {
    const html = renderToString(
      <DatastarDebugger
        open={false}
        class="outer"
        className="extra"
        style="color:red"
      />
    )

    expect(html).toContain('id="datastar-kit-debugger"')
    expect(html).toContain('class="datastar-kit-debugger outer extra"')
    expect(html).toContain('style="color:red"')
    expect(html).toContain("<details>")
    expect(html).not.toContain("<details open")

    expect(JSON.parse(attributeValue(html, "data-signals__ifmissing"))).toEqual({
      [DATASTAR_DEBUGGER_STATE_NAME]: datastarDebuggerDefaults()
    })
    expect(attributeValue(html, "data-on-signal-patch-filter")).toBe(
      `{exclude: /^${DATASTAR_DEBUGGER_STATE_NAME}(\\.|$)/}`
    )
    expect(attributeValues(html, "data-on:datastar-fetch")).toHaveLength(1)
    expect(attributeValues(html, "data-on:datastar-fetch__document")).toEqual([])
    expect(attributeValue(html, "data-bind")).toBe(`${DATASTAR_DEBUGGER_STATE_NAME}.search`)
    expect(attributeValues(html, "data-effect")).toHaveLength(2)
    expect(attributeValues(html, "data-attr:aria-selected")).toEqual([
      `${DEFAULT_SIGNAL_REF}.tab === "signals"`,
      `${DEFAULT_SIGNAL_REF}.tab === "events"`
    ])
    expect(attributeValues(html, "data-attr:aria-pressed")).toEqual([
      `${DEFAULT_SIGNAL_REF}.paused`
    ])
    expect(attributeValues(html, "data-text")).toEqual([
      `Object.keys($).filter((key) => key !== ${JSON.stringify(
        DATASTAR_DEBUGGER_STATE_NAME
      )}).length + " signals"`,
      `${DEFAULT_SIGNAL_REF}.events.length + " events"`
    ])
  })

  it("emits parseable Datastar expressions", () => {
    const html = renderToString(<DatastarDebugger />)

    for (const attribute of [
      "data-effect",
      "data-text",
      "data-show",
      "data-on:click",
      "data-on-signal-patch",
      "data-on:datastar-fetch",
      "data-attr:aria-label",
      "data-attr:aria-pressed",
      "data-attr:aria-selected",
      "data-attr:title"
    ]) {
      for (const expression of attributeValues(html, attribute)) {
        expect(() => new Script(expression)).not.toThrow()
      }
    }
  })

  it("allows a typed local state name", () => {
    const html = renderToString(<DatastarDebugger stateName="_myDebug" />)

    expect(JSON.parse(attributeValue(html, "data-signals__ifmissing"))).toEqual({
      _myDebug: datastarDebuggerDefaults()
    })
    expect(attributeValue(html, "data-bind")).toBe("_myDebug.search")
    expect(attributeValue(html, "data-on-signal-patch-filter")).toBe(
      "{exclude: /^_myDebug(\\.|$)/}"
    )
    expect(attributeValues(html, "data-text")).toContain('$_myDebug.events.length + " events"')
    expect(attributeValues(html, "data-on:click")).toContain("$_myDebug.events = []")
  })

  it("rejects non-local or nested debugger state names", () => {
    for (const stateName of ["debug", "_debug.nested", "_"]) {
      expect(() =>
        renderToString(<DatastarDebugger stateName={stateName as DatastarDebuggerStateName} />)
      ).toThrow(TypeError)
    }
  })

  it("exports the signal defaults used by the panel", () => {
    expect(datastarDebuggerDefaults()).toEqual({
      tab: "signals",
      search: "",
      paused: false,
      events: []
    })
  })

  it("records signal patches through the Datastar signal-patch handler", () => {
    const expression = attributeValue(renderToString(<DatastarDebugger />), "data-on-signal-patch")
    const debug = runtimeDebuggerState()

    runExpression(expression, {
      [DEFAULT_SIGNAL_REF]: debug,
      patch: { count: 1 }
    })

    expect(debug.events).toHaveLength(1)
    expect(debug.events[0]).toMatchObject({
      kind: "signal",
      patch: { count: 1 }
    })
    expect(typeof debug.events[0]?.at).toBe("string")
  })

  it("caps retained signal events with maxEvents", () => {
    const expression = attributeValue(
      renderToString(<DatastarDebugger maxEvents={2} />),
      "data-on-signal-patch"
    )
    const debug = runtimeDebuggerState()

    for (const count of [1, 2, 3]) {
      runExpression(expression, {
        [DEFAULT_SIGNAL_REF]: debug,
        patch: { count }
      })
    }

    expect(debug.events).toHaveLength(2)
    expect(debug.events.map((event) => (event.patch as { count: number }).count)).toEqual([3, 2])
  })

  it("does not record while paused", () => {
    const html = renderToString(<DatastarDebugger />)
    const signalExpression = attributeValue(html, "data-on-signal-patch")
    const fetchExpression = attributeValue(html, "data-on:datastar-fetch")
    const debug = { ...runtimeDebuggerState(), paused: true }

    runExpression(signalExpression, {
      [DEFAULT_SIGNAL_REF]: debug,
      patch: { count: 1 }
    })
    runExpression(fetchExpression, {
      [DEFAULT_SIGNAL_REF]: debug,
      $: { count: 1, [DATASTAR_DEBUGGER_STATE_NAME]: debug },
      evt: { detail: { type: "started", el: { id: "save" }, argsRaw: {} } }
    })

    expect(debug.events).toEqual([])
  })

  it("records Datastar fetch events with source labels and signal snapshots", () => {
    const expression = attributeValue(
      renderToString(<DatastarDebugger />),
      "data-on:datastar-fetch"
    )
    const debug = runtimeDebuggerState()

    runExpression(expression, {
      [DEFAULT_SIGNAL_REF]: debug,
      $: {
        count: 7,
        user: { name: "Ada" },
        [DATASTAR_DEBUGGER_STATE_NAME]: debug
      },
      evt: {
        detail: {
          type: "started",
          el: { id: "save" },
          argsRaw: {}
        }
      }
    })

    expect(debug.events[0]).toMatchObject({
      kind: "fetch",
      type: "started",
      element: "#save",
      argsRaw: {},
      signals: {
        count: 7,
        user: { name: "Ada" }
      }
    })
    expect(
      (debug.events[0]?.signals as Record<string, unknown> | undefined)?.[
        DATASTAR_DEBUGGER_STATE_NAME
      ]
    ).toBeUndefined()
  })

  it("records Datastar patch-element targets from fetch event args", () => {
    const expression = attributeValue(
      renderToString(<DatastarDebugger />),
      "data-on:datastar-fetch"
    )
    const debug = runtimeDebuggerState()

    runExpression(expression, {
      [DEFAULT_SIGNAL_REF]: debug,
      $: { [DATASTAR_DEBUGGER_STATE_NAME]: debug },
      evt: {
        detail: {
          type: "datastar-patch-elements",
          el: { tagName: "MAIN" },
          argsRaw: {
            selector: "#todos",
            elements: '<section id="todos">Updated</section>'
          }
        }
      }
    })

    expect(debug.events[0]).toMatchObject({
      kind: "fetch",
      type: "datastar-patch-elements",
      element: "<main>",
      target: "#todos",
      argsRaw: {
        selector: "#todos",
        elements: '<section id="todos">Updated</section>'
      }
    })
    expect(debug.events[0]?.signals).toBeUndefined()
  })
})
