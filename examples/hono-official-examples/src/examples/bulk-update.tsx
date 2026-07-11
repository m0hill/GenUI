import { Hono } from "hono"
import { event, reply, read, action, state, js, mod, put, regex } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const schema = z.object({ selections: z.array(z.boolean()).default([]) })

const bulkUpdateState = state<{ _fetching: boolean; selections: boolean[] }>({
  _fetching: false,
  selections: []
})

type BulkStatus = "Active" | "Inactive"

interface BulkRow {
  name: string
  email: string
  status: BulkStatus
}

const initialRows: BulkRow[] = [
  { name: "Joe Smith", email: "joe@smith.org", status: "Active" },
  { name: "Angie MacDowell", email: "angie@macdowell.org", status: "Inactive" },
  { name: "Fuqua Tarkenton", email: "fuqua@tarkenton.org", status: "Inactive" },
  { name: "Kim Yee", email: "kim@yee.org", status: "Active" }
]

let rows: BulkRow[] = initialRows.map((row) => ({
  name: row.name,
  email: row.email,
  status: row.status
}))

const BulkTable = ({ highlightedRows }: { highlightedRows?: Set<number> } = {}) => (
  <div
    id="demo"
    class="stack"
    data-signals={mod(bulkUpdateState.defaults, { ifMissing: true })}
  >
    <table id="bulk-update">
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              aria-label="Select all rows"
              data-on:change={action("setAll", js`el.checked`, {
                include: regex("^selections")
              })}
              data-effect={js`el.checked = ${bulkUpdateState.refs.selections}.every(Boolean)`}
              data-attr:disabled={bulkUpdateState.refs._fetching}
            />
          </th>
          <th>Name</th>
          <th>Email</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr id={`contact-${index}`}>
            <td>
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                data-bind={bulkUpdateState.refs.selections}
                data-attr:disabled={bulkUpdateState.refs._fetching}
              />
            </td>
            <td>{row.name}</td>
            <td>{row.email}</td>
            <td
              class={
                highlightedRows === undefined
                  ? row.status === "Inactive"
                    ? "inactive"
                    : undefined
                  : highlightedRows.has(index)
                    ? row.status.toLowerCase()
                    : undefined
              }
            >
              {row.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <div role="group">
      <button
        class="success"
        data-indicator={bulkUpdateState.refs._fetching}
        data-attr:disabled={bulkUpdateState.refs._fetching}
        data-on:click={put("/examples/bulk_update/activate")}
      >
        Activate
      </button>
      <button
        class="error"
        data-indicator={bulkUpdateState.refs._fetching}
        data-attr:disabled={bulkUpdateState.refs._fetching}
        data-on:click={put("/examples/bulk_update/deactivate")}
      >
        Deactivate
      </button>
    </div>
  </div>
)

const updateSelectedRows = async (request: Request, status: BulkStatus): Promise<Response> => {
  const { selections } = schema.parse(await read.signals(request))
  const selectedRows = new Set<number>()

  rows = rows.map((row, index) => {
    if (selections[index] !== true) return row

    selectedRows.add(index)
    return {
      name: row.name,
      email: row.email,
      status
    }
  })

  return reply.stream([
    event.signals({ selections: Array.from({ length: rows.length }, () => false) }),
    event.patch(<BulkTable highlightedRows={selectedRows} />)
  ])
}

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Bulk Update"
      slug="bulk_update"
      summary="Uses checkbox signals to update selected rows on the server."
      source="https://data-star.dev/examples/bulk_update"
    >
      <BulkTable />
    </ExampleLayout>,
    {
      title: "Bulk Update - Datastar Kit",
      head: pageHead()
    }
  )
)

example.put("/activate", (c) => updateSelectedRows(c.req.raw, "Active"))
example.put("/deactivate", (c) => updateSelectedRows(c.req.raw, "Inactive"))
