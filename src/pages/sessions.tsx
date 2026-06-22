import { Hono } from "hono";
import { reply } from "datastar-kit";
import { listSessions, type ChatThread } from "../session/store.js";
import { pageHead } from "../ui/head.js";
import { Icons } from "../ui/icons.js";
import { NewChatButton, PageHeader } from "../ui/layout.js";

const sessionUrl = (chatId: string): string => `/?chatId=${encodeURIComponent(chatId)}`;

const relativeTime = (iso: string): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const threadMeta = (thread: ChatThread): string => {
  const count =
    thread.messageCount === 0
      ? "Empty"
      : `${thread.messageCount} msg${thread.messageCount === 1 ? "" : "s"}`;
  const when = relativeTime(thread.updatedAt);
  return when ? `${count} · ${when}` : count;
};

export const ChatLink = () => (
  <a
    href="/"
    class="nav-pill"
    data-on:click="window.history.length > 1 && (evt.preventDefault(), window.history.back())"
  >
    <Icons.chevron aria-hidden="true" class="h-3.5 w-3.5 rotate-180" />
    Chat
  </a>
);

const SessionRow = (props: { thread: ChatThread }) => (
  <li>
    <a class="session-row" href={sessionUrl(props.thread.id)} title={props.thread.title}>
      <span class="session-row-title">{props.thread.title}</span>
      <span class="session-row-meta">{threadMeta(props.thread)}</span>
      <Icons.chevron aria-hidden="true" class="session-row-arrow h-4 w-4" />
    </a>
  </li>
);

const EmptySessions = () => (
  <div class="session-empty">
    <p class="text-fg-secondary">No saved sessions yet.</p>
    <p class="mt-1 text-sm text-fg-muted">Start a chat and it will be saved here automatically.</p>
    <div class="mt-5">
      <NewChatButton />
    </div>
  </div>
);

const SessionsPage = (props: { threads: readonly ChatThread[] }) => (
  <div class="min-h-dvh">
    <main class="shell pt-10 pb-16 lg:pt-16">
      <PageHeader
        title="Sessions"
        actions={
          <>
            <ChatLink />
            <NewChatButton />
          </>
        }
      />

      {props.threads.length === 0 ? (
        <EmptySessions />
      ) : (
        <>
          <p class="mb-4 font-mono text-[0.72rem] uppercase tracking-wide text-fg-muted">
            {props.threads.length} saved {props.threads.length === 1 ? "thread" : "threads"}
          </p>
          <ul class="session-list">
            {props.threads.map((thread) => (
              <SessionRow thread={thread} />
            ))}
          </ul>
        </>
      )}
    </main>
  </div>
);

const sessions = new Hono();

sessions.get("/", async () => {
  const threads = await listSessions();
  return reply.page(<SessionsPage threads={threads} />, {
    title: "Sessions · Hono AI chat",
    head: pageHead,
  });
});

export default sessions;
