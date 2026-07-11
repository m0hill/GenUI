import { reply } from "datastar-kit"
import { Hono } from "hono"
import { markdownResponse, prefersMarkdown, varyOnAccept } from "../../agent/markdown"
import { docPages } from "../../generated/docs"
import type { Env } from "../../server"
import { pageHead } from "../../ui/head"
import { DocsLayout } from "./layout"
import { search } from "./search"

const docs = new Hono<Env>()

docs.get("/search", search)

docs.get("/", (c) => c.redirect("/docs/introduction"))

for (const page of docPages) {
  docs.get(page.path.slice("/docs".length) || "/", (c) => {
    if (prefersMarkdown(c)) {
      return markdownResponse(page.markdown)
    }
    return varyOnAccept(
      reply.page(<DocsLayout page={page} />, {
        title: `${page.title} · Datastar Kit`,
        head: pageHead({
          ...(page.description === "" ? {} : { description: page.description }),
          path: page.path
        })
      })
    )
  })
}

export default docs
