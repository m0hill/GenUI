import { mod, unsafeHtml } from "datastar-kit"
import { AppLayout, SiteFooter, SiteHeader } from "../../ui/layout"
import { flatNav, sidebar } from "./nav"
import { DocSearch, searchState } from "./search"
import type { DocPage } from "./types"

const SidebarNav = (props: { activePath: string }) => (
  <nav class="space-y-7">
    {sidebar.map((group) => (
      <div>
        <p class="frame-label mb-3 text-fg">{group.text}</p>
        <ul class="border-l border-border-subtle">
          {group.items.map((item) => (
            <li>
              <a
                href={item.path}
                class={
                  item.path === props.activePath
                    ? "-ml-px block border-l border-accent bg-accent-dim/40 py-1.5 pr-2 pl-3.5 font-mono text-[12px] font-semibold text-accent"
                    : "-ml-px block border-l border-transparent py-1.5 pr-2 pl-3.5 font-mono text-[12px] text-fg-secondary transition-colors hover:border-accent hover:text-fg"
                }
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </nav>
)

const PrevNextNav = (props: { activePath: string }) => {
  const index = flatNav.findIndex((item) => item.path === props.activePath)
  if (index === -1) {
    return null
  }
  const prev = index > 0 ? flatNav[index - 1] : undefined
  const next = index < flatNav.length - 1 ? flatNav[index + 1] : undefined
  return (
    <nav class="mt-16 grid gap-3 border-t border-border-strong pt-6 sm:grid-cols-2">
      {prev === undefined ? (
        <span />
      ) : (
        <a
          href={prev.path}
          class="group border border-border-subtle bg-paper px-4 py-3 transition-colors hover:border-accent"
        >
          <span class="frame-label">Previous</span>
          <span class="mt-1 block text-sm font-medium text-fg-secondary transition-colors group-hover:text-accent">
            {prev.text}
          </span>
        </a>
      )}
      {next === undefined ? (
        <span />
      ) : (
        <a
          href={next.path}
          class="group border border-border-subtle bg-paper px-4 py-3 text-right transition-colors hover:border-accent"
        >
          <span class="frame-label">Next</span>
          <span class="mt-1 block text-sm font-medium text-fg-secondary transition-colors group-hover:text-accent">
            {next.text}
          </span>
        </a>
      )}
    </nav>
  )
}

const OnThisPage = (props: { page: DocPage }) => {
  if (props.page.headings.length === 0) {
    return null
  }
  return (
    <nav class="text-[13px]">
      <p class="frame-label mb-3 text-fg">On this page</p>
      <ul class="border-l border-border-subtle">
        {props.page.headings.map((heading) => (
          <li>
            <a
              href={`#${heading.slug}`}
              class={
                heading.level === 2
                  ? "block py-1 pl-3.5 text-fg-secondary transition-colors hover:text-accent"
                  : "block py-1 pl-6 text-fg-muted transition-colors hover:text-accent"
              }
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export const DocsLayout = (props: { page: DocPage }) => (
  <AppLayout>
    <div
      class="min-h-dvh"
      data-signals={mod(searchState.defaults, { ifMissing: true })}
    >
      <SiteHeader
        active="docs"
        search={<DocSearch />}
      />
      <div class="site-shell lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <aside class="border-r border-border-subtle max-lg:hidden">
          <div class="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-10 pr-6">
            <SidebarNav activePath={props.page.path} />
          </div>
        </aside>
        <div class="min-w-0 py-10 lg:px-10">
          <details class="mb-6 border border-border-subtle bg-paper lg:hidden">
            <summary class="cursor-pointer px-4 py-3 font-mono text-xs font-semibold uppercase text-fg-secondary">
              All pages
            </summary>
            <div class="border-t border-border-subtle px-4 py-4">
              <SidebarNav activePath={props.page.path} />
            </div>
          </details>
          <article class="doc mx-auto max-w-3xl">{unsafeHtml(props.page.html)}</article>
          <div class="mx-auto max-w-3xl">
            <PrevNextNav activePath={props.page.path} />
          </div>
        </div>
        <aside class="max-xl:hidden">
          <div class="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-10 pl-6">
            <OnThisPage page={props.page} />
          </div>
        </aside>
      </div>
      <SiteFooter />
    </div>
  </AppLayout>
)
