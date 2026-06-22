import { type HtmlChild } from "datastar-kit"
import { DatastarDebugger } from "datastar-kit/debugger"
import type { JSX } from "datastar-kit/jsx-runtime"

const examples = [
  { slug: "active_search", title: "Active Search" },
  { slug: "animations", title: "Animations" },
  { slug: "bad_apple", title: "Bad Apple" },
  { slug: "bulk_update", title: "Bulk Update" },
  { slug: "click_to_edit", title: "Click To Edit" },
  { slug: "click_to_load", title: "Click To Load" },
  { slug: "custom_event", title: "Custom Event" },
  { slug: "custom_plugin", title: "Custom Plugin" },
  { slug: "dbmon", title: "DBmon" },
  { slug: "delete_row", title: "Delete Row" },
  { slug: "edit_row", title: "Edit Row" },
  { slug: "event_bubbling", title: "Event Bubbling" },
  { slug: "file_upload", title: "File Upload" },
  { slug: "form_data", title: "Form Data" },
  { slug: "infinite_scroll", title: "Infinite Scroll" },
  { slug: "inline_validation", title: "Inline Validation" },
  { slug: "lazy_load", title: "Lazy Load" },
  { slug: "lazy_tabs", title: "Lazy Tabs" },
  { slug: "on_signal_patch", title: "On Signal Patch" },
  { slug: "progress_bar", title: "Progress Bar" },
  { slug: "progressive_load", title: "Progressive Load" },
  { slug: "sortable", title: "Sortable" },
  { slug: "svg_morphing", title: "SVG Morphing" },
  { slug: "counters", title: "Counters" },
  { slug: "title_update", title: "Title Update" },
  { slug: "todomvc", title: "TodoMVC" },
  { slug: "web_component", title: "Web Component" }
] as const

export const pageHead = (extra?: HtmlChild | HtmlChild[]): HtmlChild[] => [
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />,
  <link
    rel="stylesheet"
    href="/public/styles.css"
  />,
  <script
    type="module"
    src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
  />,
  ...(extra === undefined ? [] : Array.isArray(extra) ? extra : [extra])
]

export const Shell = (props: {
  title: string
  activeSlug?: string
  children: HtmlChild | HtmlChild[]
}): JSX.Element => (
  <main class="shell">
    <DatastarDebugger
      open={false}
      maxEvents={200}
    />
    <aside class="sidebar">
      <a
        class="brand"
        href="/"
      >
        Datastar Kit Examples
      </a>
      <nav>
        {examples.map((example) => (
          <a
            href={`/examples/${example.slug}`}
            class={example.slug === props.activeSlug ? "active" : undefined}
          >
            {example.title}
          </a>
        ))}
      </nav>
    </aside>
    <section class="content">
      <header class="page-header">
        <div>
          <a
            class="back-link"
            href="/"
          >
            Index
          </a>
          <h1 id="page-title">{props.title}</h1>
        </div>
      </header>
      {props.children}
    </section>
  </main>
)

export const ExampleLayout = (props: {
  title: string
  slug: string
  summary: string
  source: string
  children: HtmlChild | HtmlChild[]
}): JSX.Element => (
  <Shell
    title={props.title}
    activeSlug={props.slug}
  >
    <section class="intro">
      <p>{props.summary}</p>
      <a
        href={props.source}
        target="_blank"
        rel="noreferrer"
      >
        Official example
      </a>
    </section>
    <section class="demo">{props.children}</section>
  </Shell>
)
