import type { HtmlChild } from "datastar-kit"
import { DATASTAR_URL, GITHUB_URL } from "../constants"
import { Icons } from "./icons"

export const AppLayout = (props: { children?: HtmlChild | HtmlChild[] }): HtmlChild => [
  props.children
]

const HeaderLink = (props: { href: string; label: string; active: boolean }) => (
  <a
    href={props.href}
    class={
      props.active
        ? "border-b border-accent pb-1 font-mono text-[11px] font-semibold uppercase text-accent"
        : "border-b border-transparent pb-1 font-mono text-[11px] font-semibold uppercase text-fg-secondary transition-colors hover:border-border-strong hover:text-fg"
    }
  >
    {props.label}
  </a>
)

export const SiteHeader = (props: {
  active?: "docs" | "playground" | undefined
  search?: HtmlChild | undefined
}) => (
  <header class="sticky top-0 z-40 border-b border-border-subtle bg-bg/92 backdrop-blur">
    <div class="site-shell">
      <div class="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 py-3 sm:gap-x-6 md:h-16 md:flex-nowrap md:py-0">
        <a
          href="/"
          class="flex items-center gap-2 border-b border-transparent pb-1 text-fg"
          aria-label="Datastar Kit home"
        >
          <span class="wordmark">Datastar Kit</span>
        </a>
        <nav class="flex items-center gap-4 sm:gap-5">
          <HeaderLink
            href="/docs/introduction"
            label="Docs"
            active={props.active === "docs"}
          />
          <HeaderLink
            href="/playground"
            label="Playground"
            active={props.active === "playground"}
          />
        </nav>
        {props.search === undefined ? null : (
          <div class="order-3 w-full md:order-0 md:ml-auto md:w-72">{props.search}</div>
        )}
        <div
          class={
            props.search === undefined
              ? "ml-auto flex items-center gap-4"
              : "ml-auto flex items-center gap-4 md:ml-0"
          }
        >
          <a
            href={DATASTAR_URL}
            target="_blank"
            rel="noreferrer"
            class="font-mono text-[11px] font-semibold uppercase text-fg-secondary transition-colors hover:text-accent max-sm:hidden"
          >
            Datastar
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            class="text-fg-secondary transition-colors hover:text-accent"
          >
            <Icons.gitHub
              aria-hidden="true"
              class="h-4 w-4 fill-current"
            />
          </a>
          <button
            type="button"
            aria-label="Toggle color theme"
            class="grid h-4 w-4 cursor-pointer place-items-center text-fg-secondary transition-colors hover:text-accent"
            data-on:click="const d = document.documentElement.classList.toggle('dark'); try { localStorage.setItem('theme', d ? 'dark' : 'light') } catch (e) {}"
          >
            <Icons.moon
              aria-hidden="true"
              class="h-4 w-4 dark:hidden"
            />
            <Icons.sun
              aria-hidden="true"
              class="hidden h-4 w-4 dark:block"
            />
          </button>
        </div>
      </div>
    </div>
  </header>
)

export const SiteFooter = () => (
  <footer class="border-t border-border-subtle bg-paper/45">
    <div class="site-shell py-8">
      <div
        class="paper-rule mb-6"
        aria-hidden="true"
      />
      <div class="flex flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase text-fg-muted">
        <p class="inline-flex items-center gap-1.5">
          MIT licensed. Built for
          <img
            src="/datastar-rocket.png"
            alt=""
            width={14}
            height={14}
            class="h-3.5 w-3.5"
          />
          Datastar.
        </p>
        <nav class="flex items-center gap-4 sm:gap-5">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            class="transition-colors hover:text-accent"
          >
            GitHub
          </a>
          <a
            href={DATASTAR_URL}
            target="_blank"
            rel="noreferrer"
            class="transition-colors hover:text-accent"
          >
            Datastar
          </a>
        </nav>
      </div>
    </div>
  </footer>
)
