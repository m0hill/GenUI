import { mod, reply } from "datastar-kit"
import type { JSX } from "datastar-kit/jsx-runtime"
import { Hono } from "hono"
import { GITHUB_URL } from "../../constants"
import type { Env } from "../../server"
import { pageHead } from "../../ui/head"
import { AppLayout, SiteFooter, SiteHeader } from "../../ui/layout"
import { ComposerDemo, composerState } from "./composer"
import { StatusSearchDemo, statusSearch, statusSearchState } from "./status-search"
import { signup, ValidationDemo, validationState } from "./validation"

interface Demo {
  title: string
  body: string
  demo: JSX.Element
}

const demos: Demo[] = [
  {
    title: "Inline validation",
    body: "Signals carry the form to the server. Zod validates on the server, and errors come back as signal patches.",
    demo: <ValidationDemo />
  },
  {
    title: "Active search",
    body: "Each keystroke is debounced into a GET request. The server filters data and patches the list as HTML.",
    demo: <StatusSearchDemo />
  },
  {
    title: "Browser-only signals",
    body: "Some state never needs a round trip. These expressions stay in the browser and still start from server-rendered HTML.",
    demo: <ComposerDemo />
  }
]

const PlaygroundPage = (): JSX.Element => (
  <AppLayout>
    <div
      class="min-h-dvh"
      data-signals={mod(
        { ...validationState.defaults, ...statusSearchState.defaults, ...composerState.defaults },
        { ifMissing: true }
      )}
    >
      <SiteHeader active="playground" />
      <main class="site-shell py-14">
        <div
          class="paper-rule mb-10"
          aria-hidden="true"
        />
        <div class="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <p class="manual-kicker">Playground</p>
            <h1 class="mt-3 font-serif text-4xl leading-[1.05] font-medium tracking-tighter text-fg sm:text-5xl sm:leading-none md:text-6xl">
              Three server-backed specimens.
            </h1>
          </div>
          <p class="max-w-2xl self-end font-serif text-xl leading-relaxed text-fg-secondary">
            Live interactions served straight from the server. The page you are reading is the
            application state.
          </p>
        </div>
        <div class="mt-16 grid gap-8">
          {demos.map((item) => (
            <section class="page-enter grid gap-6 border-t border-border-strong pt-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div>
                <h2 class="font-serif text-3xl leading-tight font-medium tracking-tight text-fg">
                  {item.title}
                </h2>
                <p class="mt-3 text-sm leading-relaxed text-fg-secondary">{item.body}</p>
              </div>
              <div class="blueprint-panel bg-surface p-5 sm:p-6">{item.demo}</div>
            </section>
          ))}
        </div>
        <p class="mt-16 border-t border-border-subtle pt-6 text-sm text-fg-muted">
          Want more? The repository ships{" "}
          <a
            href={`${GITHUB_URL}/tree/main/examples`}
            target="_blank"
            rel="noreferrer"
            class="font-medium text-fg underline decoration-accent/50 decoration-dotted underline-offset-4 transition-colors hover:text-accent"
          >
            fourteen runnable examples
          </a>{" "}
          covering todos, realtime counters, modals, and a Linear-style issue tracker.
        </p>
      </main>
      <SiteFooter />
    </div>
  </AppLayout>
)

const playground = new Hono<Env>()

playground.get("/", () =>
  reply.page(<PlaygroundPage />, {
    title: "Playground · Datastar Kit",
    head: pageHead({
      description:
        "Live Datastar Kit interactions served from a stateless server: inline validation, active search, and browser-only signals.",
      path: "/playground"
    })
  })
)

playground.post("/signup", signup)
playground.get("/status", statusSearch)

export default playground
