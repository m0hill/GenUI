import { event, get, js, post, reply, unsafeHtml } from "datastar-kit"
import { Hono } from "hono"
import { DATASTAR_URL, GITHUB_URL, SITE_URL } from "../constants"
import { markdownResponse, prefersMarkdown, varyOnAccept } from "../agent/markdown"
import { snippets } from "../generated/docs"
import type { Env } from "../server"
import { pageHead } from "../ui/head"
import { Icons } from "../ui/icons"
import { AppLayout, SiteFooter, SiteHeader } from "../ui/layout"

const runtimes = [
  { slug: "hono", name: "Hono" },
  { slug: "cloudflare", name: "Cloudflare Workers" },
  { slug: "bun", name: "Bun" },
  { slug: "deno", name: "Deno" },
  { slug: "nodedotjs", name: "Node.js" }
] as const

const loop = [
  {
    verb: "Render",
    body: "Serve the first view as HTML from backend state."
  },
  {
    verb: "Listen",
    body: "Attach Datastar attributes to ordinary elements."
  },
  {
    verb: "Handle",
    body: "Decode signals and run normal TypeScript logic."
  },
  {
    verb: "Patch",
    body: "Return HTML or signals as native Response objects."
  }
] as const

const JsAsterisk = () => (
  <span class="group relative inline-block">
    <button
      type="button"
      class="cursor-help align-super text-[0.4em] leading-none text-accent transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label="Footnote: except on the server, obviously"
    >
      *
    </button>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute right-0 top-full z-10 mt-3 w-max max-w-60 whitespace-normal border border-border-strong bg-paper px-3 py-2 text-left font-sans text-sm font-normal leading-snug tracking-normal text-fg-secondary opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      * except on the server, obviously.
    </span>
  </span>
)

const InstallCopyIcon = () => (
  <span class="grid h-6 w-6 place-items-center text-fg-muted transition-colors group-hover:text-accent group-[.copied]:text-accent">
    <Icons.copy
      aria-hidden="true"
      class="h-4 w-4 group-[.copied]:hidden"
    />
    <Icons.check
      aria-hidden="true"
      class="hidden h-4 w-4 group-[.copied]:block"
    />
  </span>
)

const VisitorCount = (props: { count: number }) => (
  <span
    id="visitor-count"
    class="font-serif text-7xl font-medium tabular-nums leading-none tracking-tight text-accent sm:text-8xl"
  >
    {props.count.toLocaleString("en-US")}
  </span>
)

const Hero = () => (
  <section class="site-shell grid items-center gap-10 pt-12 pb-20 lg:grid-cols-[minmax(0,0.92fr)_minmax(30rem,1.08fr)] lg:gap-16 lg:pt-16">
    <div class="page-enter max-w-2xl">
      <a
        href={DATASTAR_URL}
        target="_blank"
        rel="noreferrer"
        class="inline-flex items-center gap-2 text-fg-secondary transition-colors hover:text-accent"
      >
        <img
          src="/datastar-rocket.png"
          alt=""
          width={18}
          height={18}
          class="h-4.5 w-4.5"
        />
        <span class="manual-kicker">Built for Datastar</span>
      </a>
      <h1 class="font-serif text-[2rem] leading-[1.02] font-medium tracking-tighter text-fg min-[420px]:text-4xl sm:text-5xl sm:leading-[0.95] md:text-6xl lg:text-7xl">
        Stop shipping JavaScript.
        <JsAsterisk />
      </h1>
      <p class="mt-5 max-w-lg font-serif text-xl leading-relaxed text-fg-secondary">
        Build interactive Datastar pages from plain TypeScript: typed data-* attributes,
        server-rendered TSX, signal readers, and native Response helpers.
      </p>
      <div class="mt-7 flex flex-wrap items-center gap-3">
        <a
          href="/docs/introduction"
          class="btn-primary"
        >
          Get started
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          class="btn-secondary"
        >
          View on GitHub
        </a>
      </div>
      <button
        type="button"
        class="group mt-6 flex w-full max-w-sm cursor-pointer items-center justify-between gap-4 border border-border-strong bg-paper px-4 py-3 text-left font-mono text-sm text-fg transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
        data-on:click={js`const btn = evt.currentTarget; navigator.clipboard.writeText(${"npm i datastar-kit"}); btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200)`}
        aria-label="Copy npm install command"
      >
        <span>
          <span class="text-fg-muted">$ </span>
          npm i datastar-kit
        </span>
        <InstallCopyIcon />
      </button>
    </div>
    <div class="min-w-0 [&_.code-block]:my-0">{unsafeHtml(snippets["counter"] ?? "")}</div>
  </section>
)

const RuntimeSheet = () => (
  <section class="bg-paper/45 [&+section]:border-t-0">
    <div class="site-shell border-y border-border-subtle">
      <div class="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="font-serif text-2xl leading-tight font-medium tracking-tight text-fg">
            Runs where you do.
          </h2>
          <p class="mt-2 text-sm text-fg-secondary">Bring any Fetch-compatible runtime.</p>
        </div>
        <div class="flex flex-wrap items-center gap-x-8 gap-y-5">
          {runtimes.map((runtime) => {
            const RuntimeIcon = Icons.runtime[runtime.slug]

            return (
              <RuntimeIcon
                role="img"
                aria-label={runtime.name}
                width={28}
                height={28}
                class="h-7 w-7 text-fg-secondary opacity-75 transition-[color,opacity] hover:text-fg hover:opacity-100"
              />
            )
          })}
        </div>
      </div>
    </div>
  </section>
)

const LoopSection = () => (
  <section class="site-shell py-16 sm:py-20 lg:py-24">
    <div class="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-16">
      <div>
        <h2 class="font-serif text-4xl leading-tight font-medium tracking-tight text-fg md:text-5xl">
          One loop, owned by your server.
        </h2>
        <p class="mt-4 font-serif text-lg leading-relaxed text-fg-secondary">
          The browser handles events and patches. Your code keeps the application model.
        </p>
      </div>
      <ol class="grid gap-px overflow-hidden rounded-[3px] border border-border-subtle bg-border-subtle sm:grid-cols-2">
        {loop.map((step, i) => (
          <li class="bg-paper p-5">
            <p class="font-mono text-[11px] font-semibold tracking-wide text-accent">
              {String(i + 1).padStart(2, "0")} · {step.verb}
            </p>
            <p class="mt-3 font-serif text-lg text-fg">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  </section>
)

const LiveDemoSection = (props: { count: number }) => (
  <section class="bg-paper/60">
    <div class="site-shell border-y border-border-subtle py-16 sm:py-20 lg:py-24">
      <div class="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(22rem,0.55fr)] lg:items-center">
        <div>
          <p class="manual-kicker">Live · Durable Object</p>
          <h2 class="mt-3 font-serif text-4xl leading-tight font-medium tracking-tight text-fg md:text-5xl">
            A counter the whole internet shares.
          </h2>
          <p class="mt-4 max-w-2xl font-serif text-lg leading-relaxed text-fg-secondary">
            Tap it. The count lives in a Cloudflare Durable Object and streams to every open tab
            over SSE — yours and everyone else's. Open a second tab and watch it move.
          </p>
        </div>
        <div
          class="blueprint-panel bg-surface p-6"
          data-init={get("/demo/counter/live")}
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="frame-label">live count</span>
            <span class="frame-label">POST /demo/counter/bump</span>
          </div>
          <div class="mt-6 flex flex-col items-center gap-6 py-2 text-center">
            <VisitorCount count={props.count} />
            <button
              type="button"
              class="btn-primary"
              data-on:click={post("/demo/counter/bump")}
            >
              +1 · tap to count
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
)

const inTheBox = [
  {
    title: "Typed attributes and actions",
    body: "data-on, data-bind, data-show, and friends are real TSX props."
  },
  {
    title: "Response helpers",
    body: "reply.page, reply.patch, reply.signals, reply.stream, and reply.navigate return native Responses."
  },
  {
    title: "Signals at the boundary",
    body: "read.signals(request) decodes Datastar payloads for your own validation layer."
  },
  {
    title: "Realtime in a few lines",
    body: "reply.stream sends SSE patches, so live multi-tab views are an ordinary handler."
  },
  {
    title: "A development debugger",
    body: "Drop one component into a page to inspect signals, patches, and SSE traffic."
  }
] as const

const BoxSection = () => (
  <section class="site-shell py-16 sm:py-20 lg:py-24">
    <div class="max-w-2xl">
      <h2 class="font-serif text-4xl leading-tight font-medium tracking-tight text-fg md:text-5xl">
        A kit, not a framework.
      </h2>
      <p class="mt-4 font-serif text-lg leading-relaxed text-fg-secondary">
        Datastar Kit owns the Datastar-shaped pieces and nothing else. Everything works anywhere a
        Request becomes a Response.
      </p>
    </div>
    <div class="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)] lg:items-center lg:gap-16">
      <div class="min-w-0 [&_.code-block]:my-0">{unsafeHtml(snippets["signals"] ?? "")}</div>
      <dl class="border-t border-border-strong">
        {inTheBox.map((item) => (
          <div class="border-b border-border-subtle py-4">
            <dt class="font-mono text-[11px] font-semibold tracking-wide uppercase text-accent">
              {item.title}
            </dt>
            <dd class="mt-1.5 text-sm leading-relaxed text-fg-secondary">{item.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
)

const ClosingSection = () => (
  <section>
    <div class="site-shell border-t border-border-subtle py-16 sm:py-20 lg:py-24 text-center">
      <div
        class="paper-rule mx-auto mb-10 max-w-xl"
        aria-hidden="true"
      />
      <h2 class="mx-auto max-w-xl font-serif text-4xl leading-tight font-medium tracking-tight text-fg md:text-5xl">
        Readable in an afternoon.
      </h2>
      <p class="mx-auto mt-4 max-w-xl font-serif text-lg leading-relaxed text-fg-secondary">
        Install it, read the introduction, and ship one server-driven page.
      </p>
      <div class="mt-8">
        <a
          href="/docs/introduction"
          class="btn-secondary"
        >
          Open docs
        </a>
      </div>
    </div>
  </section>
)

const HomePage = (props: { count: number }) => (
  <AppLayout>
    <div class="min-h-dvh">
      <SiteHeader />
      <main>
        <Hero />
        <RuntimeSheet />
        <LoopSection />
        <LiveDemoSection count={props.count} />
        <BoxSection />
        <ClosingSection />
      </main>
      <SiteFooter />
    </div>
  </AppLayout>
)

const COUNTER_ROOM = "global"

const visitorCounter = (env: CloudflareBindings) => {
  return env.VISITOR_COUNTER.get(env.VISITOR_COUNTER.idFromName(COUNTER_ROOM))
}

const index = new Hono<Env>()

const HOME_LINKS = [
  `<${SITE_URL}/>; rel="canonical"`,
  `<${SITE_URL}/docs>; rel="service-doc"`,
  `<${SITE_URL}/llms.txt>; rel="alternate"; type="text/plain"; title="llms.txt"`,
  `<${SITE_URL}/sitemap.xml>; rel="describedby"; type="application/xml"`,
  `<${SITE_URL}/.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"; title="agent-skills"`
].join(", ")

const homeMarkdown = [
  "# Datastar Kit",
  "",
  "> Server-rendered interfaces, patched like documents.",
  "",
  "A small TypeScript SDK for building server-driven UI with Datastar: typed",
  "attributes, server-rendered TSX, and native Response helpers. Runs anywhere a",
  "Request becomes a Response (Hono, Cloudflare Workers, Bun, Deno, Node.js).",
  "",
  "```sh",
  "npm i datastar-kit",
  "```",
  "",
  "## What's in the box",
  "",
  ...inTheBox.map((item) => `- **${item.title}**: ${item.body}`),
  "",
  "## Links",
  "",
  `- [Documentation](${SITE_URL}/docs/introduction)`,
  `- [Playground](${SITE_URL}/playground)`,
  `- [GitHub](${GITHUB_URL})`,
  `- [Datastar](${DATASTAR_URL})`,
  ""
].join("\n")

index.get("/", async (c) => {
  if (prefersMarkdown(c)) {
    return markdownResponse(homeMarkdown)
  }

  const count = await visitorCounter(c.env).getCount()
  const res = varyOnAccept(
    reply.page(<HomePage count={count} />, {
      title: "Datastar Kit · Server-driven UI for TypeScript",
      head: pageHead({
        description:
          "A small TypeScript SDK for building server-driven UI with Datastar: typed attributes, server-rendered TSX, and native Response helpers.",
        path: "/"
      })
    })
  )
  res.headers.set("Link", HOME_LINKS)
  return res
})

index.get("/demo/counter/live", async (c) => {
  const room = visitorCounter(c.env)
  const count = await room.getCount()
  return room.subscribe(event.patch(<VisitorCount count={count} />))
})

index.post("/demo/counter/bump", async (c) => {
  const room = visitorCounter(c.env)
  const count = await room.bump()
  c.executionCtx.waitUntil(room.publish(event.patch(<VisitorCount count={count} />)))
  return reply.done()
})

export default index
