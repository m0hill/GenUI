export const SKILL_NAME = "datastar-kit"

export const SKILL_DESCRIPTION =
  "Build server-driven UI in TypeScript with Datastar Kit: typed Datastar attributes in TSX, " +
  "signal decoding at the request boundary, and native Response helpers for pages, element patches, " +
  "signal patches, and SSE streams. Use when writing or reviewing code that imports the `datastar-kit` npm package."

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: "${SKILL_DESCRIPTION}"
---

# Datastar Kit

Datastar Kit is a small TypeScript SDK for building server-driven UI with
[Datastar](https://data-star.dev/). It is a kit, not a framework: it owns the
Datastar-shaped pieces (typed attributes, signal decoding, response helpers) and
runs anywhere a Web Standard \`Request\` becomes a \`Response\` — Hono, Cloudflare
Workers, Bun, Deno, or Node.js. Bring your own router, auth, and database.

## Install and configure

\`\`\`sh
npm i datastar-kit
\`\`\`

For TSX, set the JSX runtime in \`tsconfig.json\`:

\`\`\`json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
\`\`\`

Most code imports from the root package:

\`\`\`tsx
import { get, js, mod, post, read, reply, state } from "datastar-kit"
\`\`\`

## Mental model

The server owns the application state. The loop is: **render** the first view as
HTML, **listen** by attaching Datastar attributes to elements, **handle** the
request by decoding signals and running normal TypeScript, then **patch** the
page by returning HTML or signals as native \`Response\` objects (over SSE).

## Authoring attributes (server-rendered TSX)

Write native Datastar attributes directly as TSX props. Build action expressions
with \`get\`/\`post\`/\`put\`/\`patch\`/\`del\`, and typed signal refs with \`state\`.

\`\`\`tsx
const form = state({ email: "", errors: { email: "" } })

const Signup = () => (
  <form
    data-signals={mod(form.defaults, { ifMissing: true })}
    data-on:submit={mod(post("/signup"), { prevent: true })}
  >
    <input data-bind={form.refs.email} />
    <small
      data-show={form.refs.errors.email}
      data-text={form.refs.errors.email}
    />
  </form>
)
\`\`\`

- Wrap a value with \`mod(value, modifiers)\` when an attribute needs \`__modifier\`
  suffixes, e.g. \`data-on:input={mod(get("/search"), { debounce: "200ms" })}\`.
- For valueless presence modifiers use the one-argument form:
  \`data-ignore={mod({ self: true })}\`.
- Use the \`js\` tagged template for inline Datastar expressions; it safely
  serializes signal refs and literals.

## Reading signals at the request boundary

\`\`\`ts
const signals = await read.signals(c.req.raw)
\`\`\`

\`read.signals(request)\` decodes Datastar's signal payload from a native
\`Request\` (the \`datastar\` query param for GET/DELETE, the JSON body otherwise).
Validate the result with your own layer (e.g. Zod). It throws
\`read.SignalParseError\` / \`read.SignalShapeError\` on malformed input.

## Replying with native Responses

\`reply\` helpers return native \`Response\` objects:

| Helper                            | Status         | Use                                              |
| --------------------------------- | -------------- | ------------------------------------------------ |
| \`reply.page(body, options?)\`      | caller-defined | Full HTML document.                              |
| \`reply.patch(elements, options?)\` | 200            | One SSE element patch.                           |
| \`reply.signals(value, options?)\`  | 200            | One SSE signal patch.                            |
| \`reply.stream(events, options?)\`  | 200            | SSE stream from chunks/iterables/ReadableStream. |
| \`reply.done(init?)\`               | 204            | Complete a command with no body.                 |
| \`reply.navigate(url, options?)\`   | 200            | Safe client navigation.                          |

Action response helpers own their protocol status, so their \`init\` does not
accept \`status\`/\`statusText\`. Use \`reply.page(...)\` or a plain \`Response\` for
ordinary HTTP status semantics.

## Minimal example (Hono)

\`\`\`tsx
import { reply } from "datastar-kit"
import { Hono } from "hono"

const Count = ({ n }: { n: number }) => <span id="count">{n}</span>

const app = new Hono()

app.get("/", () =>
  reply.page(
    <button data-on:click={post("/inc")}>
      Count: <Count n={0} />
    </button>
  )
)

app.post("/inc", (c) => reply.patch(<Count n={Number(c.req.query("n")) + 1} />))

export default app
\`\`\`

## Gotchas

- Datastar attributes are real \`data-*\` props; do not invent camelCase variants.
- Element patches target by element \`id\` (or a \`selector\` option) — give patched
  elements stable ids.
- Keep handlers stateless: read signals from the request, never from module
  globals, so the same code works on edge runtimes.

## Reference

- Docs: https://datastar-kit.dev/docs/introduction
- Full API: https://datastar-kit.dev/docs/reference/api
- Markdown for agents: append \`Accept: text/markdown\` to any docs URL.
`
