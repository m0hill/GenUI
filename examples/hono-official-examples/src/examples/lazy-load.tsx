import { Hono } from "hono"
import { reply, get } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Lazy Load"
      slug="lazy_load"
      summary="Loads expensive content after the shell is already interactive."
      source="https://data-star.dev/examples/lazy_load"
    >
      <div
        id="lazy-load"
        class="loading-row"
        data-init={get("/examples/lazy_load/graph")}
      >
        Loading...
      </div>
    </ExampleLayout>,
    {
      title: "Lazy Load - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/graph", async () => {
  await new Promise((resolve) => setTimeout(resolve, 700))
  return reply.patch(
    <div
      id="lazy-load"
      class="lazy-graph"
    >
      <img
        src="https://data-star.dev/static/images/examples/tokyo-ded8c96be2a77738ddbd2f43b9d6c49e2e4c40756c8fb12ee2a60d64d4a1a0ec.png"
        alt="Tokyo"
        width={554}
        height={336}
      />
    </div>
  )
})
