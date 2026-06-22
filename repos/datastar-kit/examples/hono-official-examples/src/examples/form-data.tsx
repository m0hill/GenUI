import { Hono } from "hono"
import { reply, get, post } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const FormResult = ({ method, values }: { method: string; values: string[] }) => (
  <output
    id="form-data-result"
    class="event-output"
  >
    {values.length === 0 ? `${method}: no values submitted` : `${method}: ${values.join(", ")}`}
  </output>
)

const valuesFromRequest = async (request: Request): Promise<string[]> => {
  if (request.method === "GET") {
    return new URL(request.url).searchParams.getAll("checkboxes")
  }

  const form = await request.formData()
  return form.getAll("checkboxes").map(String)
}

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Form Data"
      slug="form_data"
      summary="Submits ordinary form encoding through Datastar fetch actions."
      source="https://data-star.dev/examples/form_data"
    >
      <div class="stack">
        <form
          id="myform"
          class="checks"
        >
          <label>
            <input
              type="checkbox"
              name="checkboxes"
              value="foo"
            />{" "}
            foo
          </label>
          <label>
            <input
              type="checkbox"
              name="checkboxes"
              value="bar"
            />{" "}
            bar
          </label>
          <label>
            <input
              type="checkbox"
              name="checkboxes"
              value="baz"
            />{" "}
            baz
          </label>
          <div role="group">
            <button
              type="button"
              data-on:click={get("/examples/form_data/data", { contentType: "form" })}
            >
              Submit GET request
            </button>
            <button
              type="button"
              data-on:click={post("/examples/form_data/data", { contentType: "form" })}
            >
              Submit POST request
            </button>
          </div>
        </form>
        <button
          type="button"
          data-on:click={get("/examples/form_data/data", {
            contentType: "form",
            selector: "#myform"
          })}
        >
          Submit GET request from outside the form
        </button>
        <FormResult
          method="Ready"
          values={[]}
        />
      </div>
    </ExampleLayout>,
    {
      title: "Form Data - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/data", async (c) =>
  reply.patch(
    <FormResult
      method="GET"
      values={await valuesFromRequest(c.req.raw)}
    />
  )
)

example.post("/data", async (c) =>
  reply.patch(
    <FormResult
      method="POST"
      values={await valuesFromRequest(c.req.raw)}
    />
  )
)
