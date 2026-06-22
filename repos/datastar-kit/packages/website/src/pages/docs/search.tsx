import { get, js, mod, read, reply, state } from "datastar-kit"
import type { JSX } from "datastar-kit/jsx-runtime"
import type { Context } from "hono"
import { z } from "zod"
import { docPages } from "../../generated/docs"
import type { Env } from "../../server"
import type { DocPage, DocSection } from "./types"

export const searchState = state({ q: "" })

const SearchSignals = z.object({
  q: z.string().optional().default("")
})

export interface SearchHit {
  page: DocPage
  section: DocSection | undefined
  score: number
  snippet: string
}

const SNIPPET_RADIUS = 70
const MAX_HITS = 8

const makeSnippet = (text: string, term: string): string => {
  const index = text.toLowerCase().indexOf(term)
  if (index === -1) {
    return text.slice(0, SNIPPET_RADIUS * 2)
  }
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + term.length + SNIPPET_RADIUS)
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

const searchDocs = (query: string): SearchHit[] => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  if (terms.length === 0) {
    return []
  }

  const hits: SearchHit[] = []
  for (const page of docPages) {
    const titleMatches = terms.filter((term) => page.title.toLowerCase().includes(term)).length
    if (titleMatches === terms.length) {
      hits.push({
        page,
        section: undefined,
        score: 100 + titleMatches,
        snippet: page.description.slice(0, SNIPPET_RADIUS * 2)
      })
    }
    for (const section of page.sections) {
      const haystackHeading = section.heading.toLowerCase()
      const haystackText = section.text.toLowerCase()
      let score = 0
      let matchedAll = true
      for (const term of terms) {
        if (haystackHeading.includes(term)) {
          score += 10
        } else if (haystackText.includes(term)) {
          score += 2
        } else {
          matchedAll = false
          break
        }
      }
      if (!matchedAll || score === 0) {
        continue
      }
      hits.push({
        page,
        section,
        score,
        snippet: makeSnippet(section.text, terms[0] ?? "")
      })
    }
  }

  return hits.toSorted((a, b) => b.score - a.score).slice(0, MAX_HITS)
}

const SearchResultsShell = (): JSX.Element => (
  <div
    class="absolute top-full right-0 left-0 z-50 mt-2 max-h-[60vh] overflow-y-auto border border-border bg-paper shadow-[0_18px_50px_rgba(23,24,18,0.14)] md:left-auto md:w-md"
    style="display:none"
    data-show={js`${searchState.refs.q} !== ''`}
  >
    <div id="search-results" />
  </div>
)

export const DocSearch = (): JSX.Element => (
  <div
    class="relative w-full md:w-64"
    data-on:click__outside={js`${searchState.refs.q} = ''`}
  >
    <input
      type="search"
      class="field py-2 text-sm"
      placeholder="Search docs"
      aria-label="Search docs"
      data-bind={searchState.refs.q}
      data-on:input={mod(get("/docs/search"), { debounce: "150ms" })}
      data-on:keydown__window={js`evt.key === '/' && document.activeElement !== el && (evt.preventDefault(), el.focus())`}
    />
    <SearchResultsShell />
  </div>
)

const SearchResults = (props: { query: string; hits: SearchHit[] }): JSX.Element => (
  <div id="search-results">
    {props.hits.length === 0 ? (
      <p class="px-4 py-6 text-center font-mono text-xs uppercase text-fg-muted">
        No results for "{props.query.trim()}"
      </p>
    ) : (
      <ul class="divide-y divide-border-subtle">
        {props.hits.map((hit) => (
          <li>
            <a
              href={
                hit.section === undefined || hit.section.slug === ""
                  ? hit.page.path
                  : `${hit.page.path}#${hit.section.slug}`
              }
              class="block px-4 py-3 transition-colors hover:bg-accent-dim/45"
            >
              <span class="block font-mono text-[11px] font-semibold uppercase text-accent">
                {hit.section === undefined || hit.section.heading === ""
                  ? hit.page.title
                  : hit.section.heading}
              </span>
              {hit.section === undefined || hit.section.heading === "" ? null : (
                <span class="mt-1 block text-xs text-fg-muted">{hit.page.title}</span>
              )}
              {hit.snippet === "" ? null : (
                <span class="mt-1 block truncate text-xs text-fg-secondary">{hit.snippet}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    )}
  </div>
)

export const search = async (c: Context<Env>) => {
  const result = SearchSignals.safeParse(await read.signals(c.req.raw))
  const query = result.success ? result.data.q.trim() : ""
  if (query === "") {
    return reply.patch(<div id="search-results" />)
  }
  return reply.patch(
    <SearchResults
      query={query}
      hits={searchDocs(query)}
    />
  )
}
