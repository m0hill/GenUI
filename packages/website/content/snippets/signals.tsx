const todo = state({ title: "" })

const Composer = () => (
  <form
    data-signals={mod(todo.defaults, { ifMissing: true })}
    data-on:submit={mod(post("/todos"), { prevent: true })}
  >
    <input data-bind={todo.refs.title} />
    <button type="submit">Add</button>
  </form>
)

app.post("/todos", async (c) => {
  const { title } = TodoSignals.parse(await read.signals(c.req.raw))
  await db.todos.insert(title)

  return reply.stream([
    event.patch(<TodoList items={await db.todos.list()} />),
    event.signals(todo.reset())
  ])
})
