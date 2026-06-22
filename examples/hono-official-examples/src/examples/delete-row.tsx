import { Hono } from "hono"
import { reply, del, js, local, mod, put } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const initialRows = [
  { name: "Joe Smith", email: "joe@smith.org" },
  { name: "Angie MacDowell", email: "angie@macdowell.org" },
  { name: "Fuqua Tarkenton", email: "fuqua@tarkenton.org" },
  { name: "Kim Yee", email: "kim@yee.org" }
]

let rows = initialRows.map((row) => ({ name: row.name, email: row.email }))
const fetching = local<boolean>("fetching")

const DeleteRowTable = () => (
  <div
    id="demo"
    data-signals={mod({ [fetching.name]: false }, { ifMissing: true })}
  >
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colspan={3}
              class="muted"
            >
              No rows remain.
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr>
              <td>{row.name}</td>
              <td>{row.email}</td>
              <td>
                <button
                  class="error"
                  data-on:click={js`if (confirm(${"Are you sure?"})) { ${del(`/examples/delete_row/${index}`)} }`}
                  data-indicator={fetching}
                  data-attr:disabled={fetching}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
    <button
      class="warning"
      data-on:click={put("/examples/delete_row/reset")}
      data-indicator={fetching}
    >
      Reset
    </button>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Delete Row"
      slug="delete_row"
      summary="Confirms a delete action and patches the remaining table rows from the server."
      source="https://data-star.dev/examples/delete_row"
    >
      <DeleteRowTable />
    </ExampleLayout>,
    {
      title: "Delete Row - Datastar Kit",
      head: pageHead()
    }
  )
)

example.delete("/:index", (c) => {
  const index = Number(c.req.param("index"))
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return c.text(`invalid index: ${c.req.param("index")}`, 400)
  }

  rows = rows.filter((_, rowIndex) => rowIndex !== index)
  return reply.patch(<DeleteRowTable />)
})

example.put("/reset", () => {
  rows = initialRows.map((row) => ({ name: row.name, email: row.email }))
  return reply.patch(<DeleteRowTable />)
})
