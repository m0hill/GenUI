import { Hono } from "hono"
import { event, reply, read, state, get, local, mod, patch, put } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.email("Enter a valid email address.")
})

type EditableRow = z.infer<typeof schema>

const editFormState = state({
  name: "",
  email: "",
  errors: {
    name: "",
    email: ""
  }
})

const initialRows: EditableRow[] = [
  { name: "Joe Smith", email: "joe@smith.org" },
  { name: "Angie MacDowell", email: "angie@macdowell.org" },
  { name: "Fuqua Tarkenton", email: "fuqua@tarkenton.org" },
  { name: "Kim Yee", email: "kim@yee.org" }
]

let rows = initialRows.map((row) => ({ name: row.name, email: row.email }))
const fetching = local<boolean>("fetching")

const DisplayRow = ({
  row,
  index,
  disabled = false
}: {
  row: EditableRow
  index: number
  disabled?: boolean
}) => (
  <tr>
    <td>{row.name}</td>
    <td>{row.email}</td>
    <td>
      {disabled ? (
        <button
          class="small info"
          data-attr:disabled={true}
        >
          Edit
        </button>
      ) : (
        <button
          class="small info"
          data-on:click={get(`/examples/edit_row/${index}`)}
          data-indicator={fetching}
          data-attr:disabled={fetching}
        >
          Edit
        </button>
      )}
    </td>
  </tr>
)

const EditingRow = ({ index }: { index: number }) => (
  <tr>
    <td>
      <input
        type="text"
        required
        data-bind={editFormState.refs.name}
        data-attr:disabled={fetching}
      />
      <small
        class="field-error"
        style="display: none"
        data-show={editFormState.refs.errors.name}
        data-text={editFormState.refs.errors.name}
      ></small>
    </td>
    <td>
      <input
        type="email"
        required
        data-bind={editFormState.refs.email}
        data-attr:disabled={fetching}
      />
      <small
        class="field-error"
        style="display: none"
        data-show={editFormState.refs.errors.email}
        data-text={editFormState.refs.errors.email}
      ></small>
    </td>
    <td>
      <button
        class="small error"
        data-on:click={get("/examples/edit_row/cancel")}
        data-indicator={fetching}
        data-attr:disabled={fetching}
      >
        Cancel
      </button>{" "}
      <button
        class="small success"
        data-on:click={patch(`/examples/edit_row/${index}`)}
        data-indicator={fetching}
        data-attr:disabled={fetching}
      >
        Save
      </button>
    </td>
  </tr>
)

const EditRowTable = ({ editingIndex }: { editingIndex?: number } = {}) => (
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
        {rows.map((row, index) =>
          editingIndex === index ? (
            <EditingRow index={index} />
          ) : (
            <DisplayRow
              row={row}
              index={index}
              disabled={editingIndex !== undefined}
            />
          )
        )}
      </tbody>
    </table>
    <div>
      <button
        class="warning"
        data-on:click={put("/examples/edit_row/reset")}
        data-indicator={fetching}
        data-attr:disabled={fetching}
      >
        Reset
      </button>
    </div>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Edit Row"
      slug="edit_row"
      summary="Replaces a single table row with an inline edit row and patches the saved result."
      source="https://data-star.dev/examples/edit_row"
    >
      <EditRowTable />
    </ExampleLayout>,
    {
      title: "Edit Row - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/cancel", () =>
  reply.stream([event.signals(editFormState.reset()), event.patch(<EditRowTable />)])
)

example.get("/:index", (c) => {
  const param = c.req.param("index")
  const index = Number(param)
  const row = rows[index]
  if (!Number.isInteger(index) || row === undefined) {
    return c.text(`invalid index: ${param}`, 400)
  }

  return reply.stream([
    event.signals(editFormState.reset(row)),
    event.patch(<EditRowTable editingIndex={index} />)
  ])
})

example.put("/reset", () => {
  rows = initialRows.map((row) => ({ name: row.name, email: row.email }))
  return reply.stream([event.signals(editFormState.reset()), event.patch(<EditRowTable />)])
})

example.patch("/:index", async (c) => {
  const param = c.req.param("index")
  const index = Number(param)
  if (!Number.isInteger(index) || rows[index] === undefined) {
    return c.text(`invalid index: ${param}`, 400)
  }

  const result = schema.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)

    return reply.signals(
      editFormState.patch({
        errors: {
          name: fieldErrors.name?.[0] ?? "",
          email: fieldErrors.email?.[0] ?? ""
        }
      })
    )
  }

  rows[index] = result.data
  return reply.stream([event.signals(editFormState.reset()), event.patch(<EditRowTable />)])
})
