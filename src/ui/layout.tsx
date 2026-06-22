import type { HtmlChild } from "datastar-kit";
import { Icons } from "./icons.js";

const KICKER = "Datastar Kit · example";

const ThemeToggle = () => (
  <button
    type="button"
    aria-label="Toggle color theme"
    class="grid h-8 w-8 shrink-0 cursor-pointer place-items-center text-fg-secondary transition-colors hover:text-accent"
    data-on:click="const d = document.documentElement.classList.toggle('dark'); try { localStorage.setItem('theme', d ? 'dark' : 'light') } catch (e) {}"
  >
    <Icons.moon aria-hidden="true" class="h-4 w-4 dark:hidden" />
    <Icons.sun aria-hidden="true" class="hidden h-4 w-4 dark:block" />
  </button>
);

export const PageHeader = (props: { title: string; actions?: HtmlChild }) => (
  <header class="mb-8">
    <p class="manual-kicker">{KICKER}</p>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 class="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{props.title}</h1>
      <div class="flex items-center gap-2">
        {props.actions}
        <ThemeToggle />
      </div>
    </div>
  </header>
);

export const SessionsLink = () => (
  <a href="/sessions" class="nav-pill">
    <Icons.grid aria-hidden="true" class="h-3.5 w-3.5" />
    Sessions
  </a>
);

export const NewChatButton = () => (
  <a href="/" class="nav-pill nav-pill-accent">
    <Icons.plus aria-hidden="true" class="h-3.5 w-3.5" />
    New
  </a>
);
