import {
  renderToString,
  get,
  js,
  local,
  mod,
  post,
  preserve,
  regex,
  signal,
  state
} from "datastar-kit"

const form = state({
  email: "",
  search: "",
  accepted: false,
  message: "",
  counter: 0,
  errors: {
    email: "",
    search: ""
  },
  items: [
    { id: "alpha", label: "Alpha" },
    { id: "beta", label: "Beta" }
  ],
  selections: [false, false]
})

const saving = local<boolean>("saving")
const panel = signal<HTMLElement, "panel">("panel")
const widgetReady = signal<boolean, "widgetReady">("widgetReady")

const DebugPanel = () => (
  <aside
    data-json-signals={mod(
      { include: regex("^(email|search|counter|errors)") },
      {
        terse: true
      }
    )}
  ></aside>
)

export const DatastarSyntaxCheck = () => (
  <main
    id="syntax-check"
    data-signals={mod(form.defaults, { ifMissing: true })}
    data-signals:items={[
      { id: "ordinary-array", label: "This array is a signal value, not modifiers" },
      { id: "second-object", label: "The second array item can be an object safely" }
    ]}
    data-computed:can-submit={mod(js`${form.refs.email}.includes(${"@"}) && !${saving}`, {
      case: "camel"
    })}
    data-on-signal-patch={mod(js`console.log(${"patch"}, patch)`, {
      debounce: "250ms"
    })}
    data-on-signal-patch-filter={{ include: regex("^(email|search|counter)$") }}
  >
    <form
      id="signup-form"
      class="stack"
      data-indicator={saving}
      data-ref={panel}
      data-attr={{
        "aria-busy": saving,
        "data-state": js`${saving} ? ${"saving"} : ${"idle"}`
      }}
      data-class={{ loading: saving, "has-errors": form.refs.errors.email }}
      data-style={{
        opacity: js`${saving} ? 0.6 : 1`,
        "pointer-events": js`${saving} ? ${"none"} : ${"auto"}`
      }}
      data-on:submit={mod(post("/signup"), { prevent: true })}
    >
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        data-bind={form.refs.email}
        data-attr:aria-invalid={js`Boolean(${form.refs.errors.email})`}
        data-on:input={mod(get("/validate/email", { contentType: "form" }), {
          debounce: { duration: "300ms", leading: true }
        })}
      />
      <small
        data-show={form.refs.errors.email}
        data-text={form.refs.errors.email}
      ></small>

      <label htmlFor="search">Search</label>
      <input
        id="search"
        name="search"
        type="search"
        data-bind={form.refs.search}
        data-on:input={mod(get("/search"), { throttle: "500ms" })}
      />

      <label>
        <input
          type="checkbox"
          data-bind={mod("accepted", { prop: "checked", event: ["input", "change"] })}
        />
        Accept terms
      </label>

      <button
        type="submit"
        data-attr:disabled={js`${saving} || !${widgetReady}`}
        data-on:click={mod(js`console.log(${"submit clicked"})`, {
          prevent: true,
          stop: true,
          once: true
        })}
      >
        Create account
      </button>
    </form>

    <section
      id="live-search"
      data-on-intersect={mod(get("/search/visible"), { once: true, half: true })}
      data-on-interval={mod(js`${form.refs.counter}++`, {
        duration: "1s",
        leading: true,
        viewTransition: true
      })}
    >
      <output data-text={js`${"Search: "} + ${form.refs.search}`}></output>
    </section>

    <my-widget
      data-on:widget-loaded={mod(js`${widgetReady} = true`, { case: "camel" })}
      data-attr:user-email={form.refs.email}
    ></my-widget>

    <div data-ignore={mod({ self: true })}>
      Third-party widget root; descendants can still be processed.
    </div>

    <details
      open
      data-preserve-attr={preserve("open", "class")}
    >
      <summary>Debug signals</summary>
      <DebugPanel />
    </details>
  </main>
)

export const renderedPreview = renderToString(<DatastarSyntaxCheck />)

console.log(renderedPreview)
