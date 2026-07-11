import { Hono } from "hono"
import { z } from "zod"
import { event, mod, post, read, reply, state } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

interface Todo {
  id: number
  title: string
  completed: boolean
}

const todos: Todo[] = []
let nextId = 1

const todoForm = state({
  title: "",
  errors: {
    title: ""
  }
})

const TodoSignals = z.object({
  title: z.string().trim().min(1, "Enter a todo title.")
})

const TodoList = (props: { todos: Todo[] }) => {
  const remaining = props.todos.filter((todo) => !todo.completed).length

  return (
    <section
      id="todos"
      aria-label="Todos"
    >
      <h2>Todos</h2>
      {props.todos.length === 0 ? (
        <p id="empty-state">No todos yet.</p>
      ) : (
        <ul>
          {props.todos.map((todo) => (
            <li
              id={`todo-${todo.id}`}
              data-completed={todo.completed}
            >
              <span>{todo.completed ? <s>{todo.title}</s> : todo.title}</span>{" "}
              <button
                type="button"
                aria-pressed={todo.completed}
                data-on:click={post(`/todos/${todo.id}/toggle`)}
              >
                {todo.completed ? "Reopen" : "Complete"}
              </button>{" "}
              <button
                type="button"
                data-on:click={post(`/todos/${todo.id}/delete`)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id="todo-count">
        {remaining} of {props.todos.length} remaining
      </p>
    </section>
  )
}

const TodoPage = (props: { todos: Todo[] }) => (
  <main data-signals={mod(todoForm.defaults, { ifMissing: true })}>
    <h1>Hono todos</h1>
    <form
      id="todo-form"
      data-on:submit={mod(post("/todos"), { prevent: true })}
    >
      <label>
        New todo
        <input
          name="title"
          autocomplete="off"
          data-bind={todoForm.refs.title}
        />
      </label>
      <button type="submit">Add todo</button>
      <small
        id="title-error"
        style="display: none; color: crimson"
        data-show={todoForm.refs.errors.title}
        data-text={todoForm.refs.errors.title}
      ></small>
    </form>
    <TodoList todos={props.todos} />
  </main>
)

export const app = new Hono()

app.get("/", () =>
  reply.page(<TodoPage todos={todos} />, {
    title: "Hono todos",
    head: (
      <script
        type="module"
        src={DATASTAR_RUNTIME}
      />
    )
  })
)

app.post("/todos", async (c) => {
  const result = TodoSignals.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)

    return reply.signals(
      todoForm.patch({ errors: { title: fieldErrors.title?.[0] ?? "Enter a todo title." } })
    )
  }

  const { title } = result.data
  todos.push({ id: nextId, title, completed: false })
  nextId += 1

  return reply.stream([event.signals(todoForm.reset()), event.patch(<TodoList todos={todos} />)])
})

app.post("/todos/:id/toggle", (c) => {
  const id = Number(c.req.param("id"))
  const todo = todos.find((item) => item.id === id)

  if (todo === undefined) {
    return c.text("Not Found", 404)
  }

  todo.completed = !todo.completed
  return reply.patch(<TodoList todos={todos} />)
})

app.post("/todos/:id/delete", (c) => {
  const id = Number(c.req.param("id"))
  const index = todos.findIndex((todo) => todo.id === id)

  if (index === -1) {
    return c.text("Not Found", 404)
  }

  todos.splice(index, 1)
  return reply.patch(<TodoList todos={todos} />)
})

app.notFound((c) => c.text("Not Found", 404))
