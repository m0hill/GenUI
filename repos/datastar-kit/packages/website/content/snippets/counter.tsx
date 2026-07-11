import { Hono } from "hono"
import { post, reply } from "datastar-kit"

const app = new Hono()

let count = 0

const Count = () => <output id="count">{count}</output>

app.get("/", () =>
  reply.page(
    <main>
      <button data-on:click={post("/increment")}>Increment</button>
      <Count />
    </main>,
    { title: "Counter" }
  )
)

app.post("/increment", () => {
  count += 1
  return reply.patch(<Count />)
})

export default app
