# datastar-kit.dev

The documentation site for Datastar Kit, built with Datastar Kit itself: a Hono app rendering
server-side TSX, deployed as a Cloudflare Worker.

## How it works

- `content/` holds the Markdown docs. They are the source of truth and stay plain GFM. The
  directory mirrors the URL: everything under `content/docs/` is served at `/docs/...`, and
  `content/docs/index.md` is the `/docs` landing page.
- `scripts/build-docs.ts` compiles the Markdown at build time into `src/generated/docs.ts`:
  rendered HTML (markdown-it + Shiki highlighting), titles, headings, and plain-text sections
  for search. The worker never parses Markdown at runtime.
- `src/server.tsx` is the single entrypoint and reads as the sitemap: it mounts each page under
  its URL prefix and wires the 404 handler. Start here to understand the whole site.
- `src/pages/` holds one MPA page per route. Each page (`index.tsx` → `/`, `playground/` →
  `/playground`, `docs/` → `/docs`) default-exports a Hono sub-app and declares its own routes at
  the top of the file; `not-found.tsx` exports the 404 handler. Pages colocate their TSX and any
  interactions (e.g. the playground demos, or the docs `layout.tsx`, `nav.ts`, `search.tsx`,
  `types.ts`).
- `src/ui/` holds the elements shared across pages: `head.tsx` (`pageHead(...)`), `layout.tsx`
  (`AppLayout`, `SiteHeader`, `SiteFooter`), and `icons.tsx`. `src/config.ts` holds site-wide
  constants (GitHub/Datastar URLs, the `/docs` mount prefix).
- `src/styles.css` is the Tailwind v4 input; `@tailwindcss/cli` compiles it to
  `public/styles.css`, which Wrangler serves as a static asset together with the self-hosted
  Geist fonts.

## Commands

```sh
pnpm dev      # build docs + css, then wrangler dev with content/css watchers
pnpm build    # compile docs manifest and css
pnpm check    # build + typecheck
pnpm deploy   # build and deploy the worker
pnpm cf-typegen # regenerate Cloudflare Worker runtime/binding types
```

Editing a file in `content/` while `pnpm dev` runs regenerates the manifest and reloads the
worker. New doc pages also need a sidebar entry in `src/pages/docs/nav.ts`.
