import { Hono } from "hono"
import { event, reply, read, get, js, local, mod, put } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const schema = z.object({
  mutationRate: z.coerce.number().min(0).max(100).optional(),
  fps: z.coerce.number().min(1).max(144).optional()
})

interface Database {
  name: string
  count: number
  queries: Array<{
    elapsed: number
    text: string
  }>
}

const queryTexts = ["SELECT blah from something", "<IDLE> in transaction", "vacuum"] as const

let config = { mutationRate: 20, fps: 60 }
const editing = local<boolean>("editing")

const randomDatabase = (name: string): Database => ({
  name,
  count: Math.floor(Math.random() * 16),
  queries: Array.from({ length: 5 }, () => ({
    elapsed: Math.floor(Math.random() * 16),
    text: queryTexts[Math.floor(Math.random() * queryTexts.length)] ?? queryTexts[0]
  })).toSorted((left, right) => left.elapsed - right.elapsed)
})

let databases: Database[] = Array.from({ length: 12 }, (_, index) => {
  const cluster = Math.floor(index / 2) + 1
  return randomDatabase(index % 2 === 0 ? `cluster${cluster}` : `cluster${cluster}slave`)
})

const DbmonDemo = ({ renderTime }: { renderTime: number }) => (
  <div
    id="demo"
    data-init={get("/examples/dbmon/updates")}
    data-signals={mod({ [editing.name]: false }, { ifMissing: true })}
  >
    <p>
      Average render time for entire page: {renderTime === 0 ? "0s" : `${renderTime.toFixed(3)}µs`}
    </p>
    <div role="group">
      <label>
        Mutation Rate %
        <input
          type="number"
          min="0"
          max="100"
          value={config.mutationRate}
          data-on:focus={js`${editing} = true`}
          data-on:blur={js`${put("/examples/dbmon/inputs")}; ${editing} = false`}
          {...{ "data-attr:data-bind:mutation-rate": editing }}
          {...{ "data-attr:data-bind:_mutation-rate": js`!${editing}` }}
        />
      </label>
      <label>
        FPS
        <input
          type="number"
          min="1"
          max="144"
          value={config.fps}
          data-on:focus={js`${editing} = true`}
          data-on:blur={js`${put("/examples/dbmon/inputs")}; ${editing} = false`}
          {...{ "data-attr:data-bind:fps": editing }}
          {...{ "data-attr:data-bind:_fps": js`!${editing}` }}
        />
      </label>
    </div>
    <table class="dbmon-table">
      <tbody>
        {databases.map((database) => (
          <tr>
            <td>{database.name}</td>
            <td
              class={
                database.count >= 15
                  ? "query-count danger-cell"
                  : database.count >= 10
                    ? "query-count warn-cell"
                    : "query-count ok-cell"
              }
            >
              {database.count}
            </td>
            {database.queries.map((query) => (
              <td aria-description={query.text}>
                {query.elapsed === 0 ? "0s" : `${query.elapsed}ms`}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="DBmon"
      slug="dbmon"
      summary="Streams a changing database monitor table while form inputs tune the update rate."
      source="https://data-star.dev/examples/dbmon"
    >
      <DbmonDemo renderTime={0} />
    </ExampleLayout>,
    {
      title: "DBmon - Datastar Kit",
      head: pageHead()
    }
  )
)

example.put("/inputs", async (c) => {
  const result = schema.safeParse(await read.signals(c.req.raw))

  if (result.success) {
    config = {
      mutationRate: result.data.mutationRate ?? config.mutationRate,
      fps: result.data.fps ?? config.fps
    }
  }

  return reply.done()
})

example.get("/updates", (c) =>
  reply.stream(
    (async function* () {
      let renderTime = 0

      while (!c.req.raw.signal.aborted) {
        databases = databases.map((database) =>
          Math.random() * 100 > config.mutationRate ? database : randomDatabase(database.name)
        )

        const start = performance.now()
        const patch = event.patch(<DbmonDemo renderTime={renderTime} />)
        renderTime = (performance.now() - start) * 1000

        yield event.signals({ _mutationRate: config.mutationRate, _fps: config.fps })
        yield patch
        await new Promise((resolve) => setTimeout(resolve, 1000 / config.fps))
      }
    })(),
    { heartbeat: { intervalMs: 15_000, comment: "dbmon" } }
  )
)
