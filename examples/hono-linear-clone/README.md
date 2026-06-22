# Hono Linear clone

A small Linear-style issue tracker built with Hono, Datastar Kit, Drizzle ORM, SQLite, Drizzle Kit, and Zod.

The example intentionally starts with no data. Create an account in the UI, then create projects, issues, and comments from there.

## Run

```sh
pnpm --filter @datastar-kit/example-hono-linear-clone dev
```

The `dev` script runs the TSX source directly. Run migrations separately when the schema changes:

```sh
pnpm --filter @datastar-kit/example-hono-linear-clone db:migrate
```

## What it shows

- `state(...)` for form state, validation messages, and typed signal patches.
- `read.signals(request)` plus Zod at command boundaries.
- Server-rendered TSX patches for the board, sidebar, issue composer, and issue detail panel.
- Realtime current-state rendering with an in-memory invalidation hub and `reply.stream(...)`.
- Authenticated access to one shared company workspace.
- Drizzle schema in `src/db/schema.ts`, managed through Drizzle Kit.

## Code organization

This example is organized around pages, not frontend/backend layers:

- `src/pages/login.tsx` and `src/pages/signup.tsx` keep each auth page's signals, schema, view, and routes together.
- `src/pages/workspace.tsx` keeps the main workspace page, workspace signals, workspace queries, project creation, live board/sidebar patches, and modal UI together.
- `src/pages/issue.tsx` keeps issue creation, issue detail loading, issue updates, comments, and issue-panel rendering together.
- `src/shared/` contains small primitives and constants that are reused by multiple pages.
- `src/auth/`, `src/db/`, and `src/realtime/` contain infrastructure that is not owned by one page.

The page files are intentionally a little longer. The goal is that a reader can open one file and follow the Datastar flow in order: render signals, read signals, validate input, mutate backend state, then patch signals or server-rendered HTML.
