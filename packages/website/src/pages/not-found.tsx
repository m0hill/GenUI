import { reply } from "datastar-kit"
import type { NotFoundHandler } from "hono"
import { pageHead } from "../ui/head"
import { AppLayout, SiteFooter, SiteHeader } from "../ui/layout"

const NotFoundPage = () => (
  <AppLayout>
    <div class="flex min-h-dvh flex-col">
      <SiteHeader />
      <main class="site-shell flex flex-1 items-center justify-center py-16 text-center sm:py-24">
        <div class="blueprint-panel max-w-xl p-8 sm:p-10">
          <p class="manual-kicker">404</p>
          <h1 class="mt-3 font-serif text-4xl leading-[1.05] font-medium tracking-tighter text-fg sm:text-5xl sm:leading-none">
            Page not found.
          </h1>
          <p class="mt-4 font-serif text-lg leading-relaxed text-fg-secondary">
            Nothing lives at this URL. Try the docs or head back home.
          </p>
          <div class="mt-8 flex justify-center gap-3">
            <a
              href="/docs/introduction"
              class="btn-primary"
            >
              Read the docs
            </a>
            <a
              href="/"
              class="btn-secondary"
            >
              Home
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  </AppLayout>
)

export const notFound: NotFoundHandler = () =>
  reply.page(
    <NotFoundPage />,
    { title: "Not found · Datastar Kit", head: pageHead({}) },
    { status: 404 }
  )
