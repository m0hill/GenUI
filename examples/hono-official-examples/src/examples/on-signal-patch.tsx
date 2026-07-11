import { Hono } from "hono"
import { reply, state, js, mod, regex } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const patchState = state({
  counter: 0,
  message: "Hello World",
  allChanges: [],
  counterChanges: []
})

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="On Signal Patch"
      slug="on_signal_patch"
      summary="Records signal patches with Datastar's signal-patch event hooks."
      source="https://data-star.dev/examples/on_signal_patch"
    >
      <div
        class="stack"
        data-signals={mod(patchState.defaults, { ifMissing: true })}
      >
        <div class="actions">
          <button
            data-on:click={js`${patchState.refs.message} = ${"Updated: "} + performance.now().toFixed(2)`}
          >
            Update Message
          </button>
          <button data-on:click={js`${patchState.refs.counter} = ${patchState.refs.counter} + 1`}>
            Increment Counter
          </button>
          <button
            class="error"
            data-on:click={js`${patchState.refs.allChanges} = []; ${patchState.refs.counterChanges} = []`}
          >
            Clear All Changes
          </button>
        </div>
        <div class="grid">
          <section class="subdemo">
            <h2>Current Values</h2>
            <p>
              Counter: <span data-text={patchState.refs.counter}></span>
            </p>
            <p>
              Message: <span data-text={patchState.refs.message}></span>
            </p>
          </section>
          <section
            class="subdemo"
            data-on-signal-patch={js`${patchState.refs.counterChanges}.push(patch)`}
            data-on-signal-patch-filter={{ include: regex("^counter$") }}
          >
            <h2>Counter Changes Only</h2>
            <pre
              class="signal-log"
              data-text={js`JSON.stringify({ counterChanges: ${patchState.refs.counterChanges} })`}
            ></pre>
          </section>
          <section
            class="subdemo"
            data-on-signal-patch={js`${patchState.refs.allChanges}.push(patch)`}
            data-on-signal-patch-filter={{
              exclude: regex("(^|\\.)_|allChanges|counterChanges")
            }}
          >
            <h2>All Signal Changes</h2>
            <pre
              class="signal-log"
              data-text={js`JSON.stringify({ allChanges: ${patchState.refs.allChanges} })`}
            ></pre>
          </section>
        </div>
      </div>
    </ExampleLayout>,
    {
      title: "On Signal Patch - Datastar Kit",
      head: pageHead()
    }
  )
)
