import { get, mod, read, reply, state } from "datastar-kit"
import type { Context } from "hono"
import { z } from "zod"
import type { Env } from "../../server"

interface StatusCode {
  code: number
  text: string
  blurb: string
}

const statusCodes: StatusCode[] = [
  { code: 200, text: "OK", blurb: "The request succeeded." },
  { code: 201, text: "Created", blurb: "A new resource was created." },
  {
    code: 204,
    text: "No Content",
    blurb: "Success with an empty body. Datastar Kit uses it for reply.done()."
  },
  { code: 301, text: "Moved Permanently", blurb: "The resource has a new canonical URL." },
  { code: 302, text: "Found", blurb: "Temporary redirect to another URL." },
  { code: 304, text: "Not Modified", blurb: "The cached representation is still valid." },
  { code: 400, text: "Bad Request", blurb: "The server cannot process the malformed request." },
  { code: 401, text: "Unauthorized", blurb: "Authentication is required and has failed." },
  { code: 403, text: "Forbidden", blurb: "Authenticated, but not allowed." },
  { code: 404, text: "Not Found", blurb: "No resource lives at this URL." },
  { code: 409, text: "Conflict", blurb: "The request conflicts with the current state." },
  { code: 418, text: "I'm a teapot", blurb: "The server refuses to brew coffee in a teapot." },
  { code: 422, text: "Unprocessable Content", blurb: "Well-formed, but semantically invalid." },
  { code: 429, text: "Too Many Requests", blurb: "The client is being rate limited." },
  { code: 500, text: "Internal Server Error", blurb: "Something failed on the server." },
  { code: 503, text: "Service Unavailable", blurb: "The server is temporarily overloaded or down." }
]

export const statusSearchState = state({ filter: "" })

const StatusSignals = z.object({
  filter: z.string().optional().default("")
})

const StatusList = (props: { items: StatusCode[] }) => (
  <ul
    id="status-list"
    class="max-h-72 space-y-1 overflow-y-auto pr-1"
  >
    {props.items.length === 0 ? (
      <li class="border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
        No status codes match.
      </li>
    ) : (
      props.items.map((item) => (
        <li class="flex items-baseline gap-3 border border-border-subtle bg-paper/60 px-3.5 py-2.5">
          <span class="font-mono text-sm font-semibold text-accent">{item.code}</span>
          <span class="text-sm font-medium text-fg">{item.text}</span>
          <span class="truncate text-xs text-fg-muted max-sm:hidden">{item.blurb}</span>
        </li>
      ))
    )}
  </ul>
)

export const StatusSearchDemo = () => (
  <div class="space-y-4">
    <input
      type="search"
      class="field"
      placeholder="Filter by code or name, try 4 or teapot"
      aria-label="Filter status codes"
      data-bind={statusSearchState.refs.filter}
      data-on:input={mod(get("/playground/status"), { debounce: "150ms" })}
    />
    <StatusList items={statusCodes} />
  </div>
)

export const statusSearch = async (c: Context<Env>) => {
  const result = StatusSignals.safeParse(await read.signals(c.req.raw))
  const filter = result.success ? result.data.filter.trim().toLowerCase() : ""
  const items =
    filter === ""
      ? statusCodes
      : statusCodes.filter(
          (item) =>
            String(item.code).includes(filter) ||
            item.text.toLowerCase().includes(filter) ||
            item.blurb.toLowerCase().includes(filter)
        )
  return reply.patch(<StatusList items={items} />)
}
