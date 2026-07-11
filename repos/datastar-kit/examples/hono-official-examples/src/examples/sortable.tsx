import { Hono } from "hono"
import { reply, js, signal } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const orderInfo = signal<string>("orderInfo")

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Sortable"
      slug="sortable"
      summary="Combines SortableJS with a Datastar custom event to report the new order."
      source="https://data-star.dev/examples/sortable"
    >
      <div class="stack">
        <output
          class="event-output"
          data-signals={{ [orderInfo.name]: "Initial order" }}
          data-text={orderInfo}
        ></output>
        <div
          id="sortContainer"
          class="sortable-list"
          data-on:reordered={js`${orderInfo} = evt.detail.orderInfo`}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <button type="button">Item {index + 1}</button>
          ))}
        </div>
      </div>
    </ExampleLayout>,
    {
      title: "Sortable - Datastar Kit",
      head: pageHead(
        <script
          type="module"
          src="/public/sortable.js"
        />
      )
    }
  )
)
