import { Hono } from "hono"
import { event, reply, read, state, get, js, mod } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const agents = Array.from({ length: 100 }, (_, index) => ({
  name: `Agent Smith ${index}`,
  email: `void${index + 1}@null.org`,
  id: (0x65cd25028f98f158n + BigInt(index) * 0x6789n).toString(16)
}))

const pageSize = 10
const maxInitialRows = agents.length - pageSize

const schema = z.object({
  offset: z.number().int().min(0).max(agents.length).default(0),
  limit: z.number().int().min(1).max(50).default(pageSize)
})

const scrollState = state({ offset: 0, limit: pageSize })

const agentRows = (start: number, end: number) =>
  agents.slice(start, end).map((agent) => (
    <tr>
      <td>{agent.name}</td>
      <td>{agent.email}</td>
      <td>
        <code>{agent.id}</code>
      </td>
    </tr>
  ))

const Loader = () => (
  <div
    id="infinite-scroll-loader"
    class="loading-row"
    data-on-intersect={get("/examples/infinite_scroll/more")}
  >
    Loading...
  </div>
)

const EnoughScrolling = () => (
  <div
    id="demo"
    class="stack"
  >
    <p>That’s enough scrolling for you.</p>
    <iframe
      class="wide"
      width="560"
      height="315"
      src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=Flaiw-OADzippqDg?rel=0&autoplay=1"
      title="YouTube video player"
      allow="autoplay"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Infinite Scroll"
      slug="infinite_scroll"
      summary="Loads the next page automatically when the sentinel intersects the viewport."
      source="https://data-star.dev/examples/infinite_scroll"
    >
      <div
        id="demo"
        class="stack"
        data-signals={mod(scrollState.defaults, { ifMissing: true })}
        data-init={get("/examples/infinite_scroll/initial", {
          payload: {
            limit: js`Math.ceil(window.innerHeight / 44) + 4`
          }
        })}
      >
        <table>
          <caption>Agents</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody id="agents"></tbody>
        </table>
        <div
          id="infinite-scroll-loader"
          class="loading-row"
        >
          Loading...
        </div>
      </div>
    </ExampleLayout>,
    {
      title: "Infinite Scroll - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/initial", async (c) => {
  const { limit } = schema.parse(await read.signals(c.req.raw))
  const initialRows = Math.min(Math.max(limit, pageSize), maxInitialRows)

  return reply.stream([
    event.signals(scrollState.patch({ offset: initialRows, limit: pageSize })),
    event.patch(agentRows(0, initialRows), { selector: "#agents", mode: "inner" }),
    event.patch(<Loader />)
  ])
})

example.get("/more", async (c) => {
  const { offset, limit } = schema.parse(await read.signals(c.req.raw))

  if (offset >= agents.length) {
    return reply.patch(<EnoughScrolling />)
  }

  const nextOffset = Math.min(offset + limit, agents.length)

  return reply.stream([
    event.signals(scrollState.patch({ offset: nextOffset, limit })),
    event.patch(agentRows(offset, nextOffset), { selector: "#agents", mode: "append" }),
    event.patch(<Loader />)
  ])
})
