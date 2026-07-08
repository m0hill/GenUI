# Hono AI chat

A simple server-driven AI chat built with Hono, Datastar, Datastar Kit, and `@earendil-works/pi-ai`.

The page sends the prompt as Datastar signals. The server first appends the user message and an empty assistant shell, then streams normal assistant text and optionally runs a `create_ui` tool that streams model-generated HTML into the same assistant message.

## What it demonstrates

- Hono routes returning native Datastar Kit `Response` helpers;
- `data-signals`, `data-bind`, `data-indicator`, and typed `post(...)` actions;
- reading form state with `read.signals(...)`;
- streaming multiple Datastar events with `reply.stream(...)` and `event.patch(...)`;
- JSONL-backed chat sessions restored through a Datastar sidebar;
- normal chat responses plus a `create_ui` tool for generated HTML UI fragments;
- generated forms/buttons that post follow-up prompts back through Datastar;
- rendering tool-generated HTML with a small sanitize/repair pass;
- sandboxing generated UI in an `allow-scripts` iframe with a capability bridge;
- brokered generated UI actions such as `chat.follow_up` instead of direct app access;
- a manifest-based generated UI lease: the model chooses capability names in `create_ui.capabilities`, the sanitizer keeps only leased `@capability(...)` calls, and the host broker enforces the same lease before invoking server tools;
- trusted local Datastar primitives such as `@toast(...)`, `@setSignal(...)`, and `data-focus-when`, plus demo capabilities for palette generation, weather lookup, and approval-gated notes;
- static CSS served from `public/` through Hono static assets;
- a stable element-id patch contract for streaming assistant content.

## Run it

Create `auth.json` with OpenAI Codex OAuth credentials, then run:

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:3000>.

Sessions are stored as JSONL files in `.sessions/`.

## Generated UI architecture

The standalone framework notes for the generated UI capability runtime live in
[`docs/genui/`](docs/genui/README.md).
