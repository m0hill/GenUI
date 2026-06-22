import { Hono } from "hono"
import { event, reply, get } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const currentTime = () => new Date().toLocaleTimeString()

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Title Update"
      slug="title_update"
      summary="Streams patches to the document title and a visible timestamp."
      source="https://data-star.dev/examples/title_update"
    >
      <p data-init={get("/examples/title_update/updates")}>
        Look at the title change in the browser tab!
      </p>
    </ExampleLayout>,
    {
      title: "Title Update - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/updates", (c) => {
  async function* stream() {
    while (!c.req.raw.signal.aborted) {
      const time = currentTime()
      yield event.patch(<title>{time}</title>, { selector: "title" })
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return reply.stream(stream(), { heartbeat: { intervalMs: 15_000, comment: "title-update" } })
})
