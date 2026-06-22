import { Hono } from "hono"
import { reply, state, js, mod } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const keyState = state({ key: "" })

const keys = [
  "KEY ELSE",
  "CM",
  "OM",
  "FETCH",
  "SET",
  "EXEC",
  "TEST ALARM",
  "3",
  "2",
  "1",
  "ENTER",
  "CLEAR"
]

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Event Bubbling"
      slug="event_bubbling"
      summary="Uses one delegated click listener to read button metadata from bubbled events."
      source="https://data-star.dev/examples/event_bubbling"
    >
      <div
        id="demo"
        data-signals={mod(keyState.defaults, { ifMissing: true })}
      >
        <p>
          Key pressed: <span data-text={keyState.refs.key}></span>
        </p>
        <div
          id="event-bubbling-container"
          class="keypad"
          data-on:click={js`${keyState.refs.key} = evt.target.closest(${"button[data-id]"})?.dataset.id ?? ${keyState.refs.key}`}
        >
          {keys.map((key) => (
            <button
              data-id={key}
              class={key.includes(" ") ? "gray" : undefined}
            >
              {key.includes(" ") ? key.split(" ").map((part) => [part, <br />]) : key}
            </button>
          ))}
        </div>
      </div>
    </ExampleLayout>,
    {
      title: "Event Bubbling - Datastar Kit",
      head: pageHead()
    }
  )
)
