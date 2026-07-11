import { Hono } from "hono"
import { reply, state, js, mod } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const eventState = state({ _eventDetails: "Waiting for event..." })

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Custom Event"
      slug="custom_event"
      summary="Listens to a browser CustomEvent and copies the event detail into a local signal."
      source="https://data-star.dev/examples/custom_event"
    >
      <div class="stack">
        <p
          id="custom-event-target"
          class="event-output"
          data-signals={mod(eventState.defaults, { ifMissing: true })}
          data-on:myevent={js`${eventState.refs._eventDetails} = evt.detail`}
          data-text={js`${"Last Event Details: "} + ${eventState.refs._eventDetails}`}
        ></p>
      </div>
    </ExampleLayout>,
    {
      title: "Custom Event - Datastar Kit",
      head: pageHead(
        <script
          type="module"
          src="/public/custom-event.js"
        />
      )
    }
  )
)
