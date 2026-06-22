import { Hono } from "hono"
import { event, reply, read, state, js, mod, post } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const maxFileBytes = 1024 * 1024

const base64ByteLength = (contents: string): number => {
  const padding = contents.endsWith("==") ? 2 : contents.endsWith("=") ? 1 : 0
  return Math.floor((contents.length * 3) / 4) - padding
}

const isBase64 = (contents: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(contents) && contents.length % 4 === 0

const UploadedFile = z.object({
  name: z.string().min(1, "File name is required."),
  mime: z.string(),
  contents: z
    .string()
    .refine(isBase64, "File contents must be base64 encoded.")
    .refine(
      (contents) => base64ByteLength(contents) < maxFileBytes,
      "Each file must be less than 1 MiB."
    )
})

const schema = z.object({
  files: z.array(UploadedFile).min(1, "Choose at least one file.")
})

type UploadedFile = z.infer<typeof UploadedFile>

const uploadState = state({
  files: [],
  errors: {
    files: ""
  }
})

const UploadResult = ({ files = [] }: { files?: readonly UploadedFile[] }) => (
  <div
    id="file-upload-result"
    class="event-output"
  >
    {files.length === 0 ? (
      <span>No files uploaded yet.</span>
    ) : (
      <ul>
        {files.map((file) => (
          <li>
            <strong>{file.name}</strong> ({file.mime || "unknown type"},{" "}
            {base64ByteLength(file.contents)} bytes)
          </li>
        ))}
      </ul>
    )}
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="File Upload"
      slug="file_upload"
      summary="Binds file inputs into Datastar signals and posts the encoded file list."
      source="https://data-star.dev/examples/file_upload"
    >
      <div
        class="stack"
        data-signals={mod(uploadState.defaults, { ifMissing: true })}
      >
        <label>
          <span>Pick anything less than 1 MiB</span>
          <input
            type="file"
            multiple
            data-bind={uploadState.refs.files}
            data-on:change={js`${uploadState.refs.errors.files} = ${""}`}
          />
        </label>
        <small
          class="field-error"
          style="display: none"
          data-show={uploadState.refs.errors.files}
          data-text={uploadState.refs.errors.files}
        ></small>
        <button
          class="warning"
          data-attr:disabled={js`!${uploadState.refs.files}.length`}
          data-on:click={js`if (${uploadState.refs.files}.length) { ${post("/examples/file_upload")} }`}
        >
          Submit
        </button>
        <UploadResult />
      </div>
    </ExampleLayout>,
    {
      title: "File Upload - Datastar Kit",
      head: pageHead()
    }
  )
)

example.post("/", async (c) => {
  const result = schema.safeParse(await read.signals(c.req.raw))

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error)
    return reply.signals(
      uploadState.patch({
        errors: { files: fieldErrors.files?.[0] ?? "Choose at least one file." }
      })
    )
  }

  return reply.stream([
    event.signals(uploadState.patch({ errors: { files: "" } })),
    event.patch(<UploadResult files={result.data.files} />)
  ])
})
