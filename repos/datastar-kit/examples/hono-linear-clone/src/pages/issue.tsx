import { HTTPException } from "hono/http-exception"
import { event, read, reply, state, get, mod, patch, post } from "datastar-kit"
import { z } from "zod"
import { pageHead, type App } from "../app.js"
import {
  createComment,
  loadIssue,
  loadIssueComments,
  loadIssueRecord,
  type IssueComments,
  type IssueDetail,
  type IssueRecord,
  updateIssue
} from "../db/issue.js"
import { issuePriorityValues, issueStatusValues } from "../db/schema.js"
import { invalidations } from "../realtime/hub.js"
import { issuePriorities, issueStatuses } from "./workspace.js"

const issueIdParam = z.coerce.number().int().positive()

const updateIssueSchema = z.object({
  status: z.enum(issueStatusValues).optional(),
  priority: z.enum(issuePriorityValues).optional()
})

const commentSchema = z.object({
  commentBody: z
    .string()
    .trim()
    .min(1, "Write a comment")
    .max(1200, "Keep it under 1200 characters")
})

const issueState = state({
  commentBody: "",
  _validation: {
    commentBody: ""
  }
})

const IssuePage = (props: { detail: IssueDetail }) => (
  <main
    class="min-h-screen bg-bg text-fg"
    data-signals={mod(issueState.defaults, { ifMissing: true })}
    data-init={get(`/issues/${props.detail.issue.id}/live`)}
  >
    <header class="h-15 border-b border-border flex items-center justify-between px-5 lg:px-8 bg-surface/40 backdrop-blur-md">
      <a
        href="/workspace"
        class="text-[13px] font-medium text-fg-secondary hover:text-fg hover:underline flex items-center gap-2"
      >
        <span class="text-fg-muted">‹</span> Workspace
      </a>
      <span class="section-label">Issue Detail</span>
    </header>
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 lg:p-8">
      <IssuePageContent detail={props.detail} />
    </section>
  </main>
)

export const IssuePageContent = (props: { detail: IssueDetail | null }) => (
  <div id="issue-page-content">
    {props.detail === null ? null : <IssueDetailView detail={props.detail} />}
  </div>
)

const IssueDetailView = (props: { detail: IssueDetail }) => {
  const { issue, comments: issueComments } = props.detail
  return (
    <div class="flex flex-col gap-5">
      <IssueOverview issue={issue} />

      <IssueProperties issue={issue} />

      <IssueCommentsList comments={issueComments} />

      <form
        class="flex flex-col gap-3 bg-surface border border-border p-4"
        data-on:submit={mod(post(`/issues/${issue.id}/comments`), { prevent: true })}
      >
        <label class="flex flex-col gap-1.5 section-label">
          Add a comment
          <textarea
            class="field"
            rows={3}
            placeholder="Write a comment..."
            data-bind={issueState.refs.commentBody}
          ></textarea>
          <small
            class="text-danger text-[13px] font-medium min-h-4"
            data-text={issueState.refs._validation.commentBody}
          ></small>
        </label>
        <button
          type="submit"
          class="btn-primary self-start"
        >
          Post comment
        </button>
      </form>
    </div>
  )
}

const IssueOverview = (props: { issue: NonNullable<IssueRecord> }) => (
  <div
    id="issue-overview"
    class="bg-surface border border-border p-5"
  >
    <div class="flex items-center gap-2 mb-3">
      <span class="text-xs text-fg-muted select-none">›</span>
      <span class="font-mono text-[12px] text-fg-muted tracking-tight bg-surface-inset border border-border px-2 py-0.5 rounded-md">
        {props.issue.projectKey}-{props.issue.number}
      </span>
    </div>
    <h2 class="text-[18px] font-semibold text-fg leading-snug tracking-tight">
      {props.issue.title}
    </h2>
    <p
      class={`mt-2 text-[13px] leading-relaxed ${props.issue.description ? "text-fg-secondary" : "text-fg-muted italic"}`}
    >
      {props.issue.description || "No description provided."}
    </p>
  </div>
)

const IssueProperties = (props: { issue: NonNullable<IssueRecord> }) => (
  <div
    id="issue-properties"
    class="bg-surface border border-border p-4"
  >
    <h3 class="section-label mb-3">Properties</h3>
    <form
      class="flex flex-col bg-surface-inset border border-border rounded-xl px-3"
      data-on:change={patch(`/issues/${props.issue.id}`, {
        selector: null,
        contentType: "form"
      })}
    >
      <div class="grid grid-cols-[80px_1fr] items-center gap-3 py-2.5 border-b border-border-subtle">
        <label class="section-label">Status</label>
        <select
          name="status"
          class="field"
        >
          {issueStatuses.map((status) => (
            <option
              value={status.value}
              selected={props.issue.status === status.value}
            >
              {status.label}
            </option>
          ))}
        </select>
      </div>
      <div class="grid grid-cols-[80px_1fr] items-center gap-3 py-2.5">
        <label class="section-label">Priority</label>
        <select
          name="priority"
          class="field"
        >
          {issuePriorities.map((priority) => (
            <option
              value={priority.value}
              selected={props.issue.priority === priority.value}
            >
              {priority.label}
            </option>
          ))}
        </select>
      </div>
    </form>
  </div>
)

const IssueCommentsList = (props: { comments: IssueComments }) => (
  <div
    id="issue-comments"
    class="bg-surface border border-border p-4"
  >
    <h3 class="section-label mb-3">Comments ({props.comments.length})</h3>
    {props.comments.length === 0 ? (
      <p class="text-fg-muted text-[13px]">No comments yet.</p>
    ) : (
      <div class="flex flex-col gap-3">
        {props.comments.map((comment) => (
          <article class="flex flex-col gap-1 bg-surface-inset border border-border border-l-border-strong border-l-4 p-3 rounded-lg">
            <span class="text-[13px] font-semibold text-fg-secondary">{comment.authorName}</span>
            <p class="text-[13px] text-fg-secondary leading-relaxed">{comment.body}</p>
          </article>
        ))}
      </div>
    )}
  </div>
)

export const registerIssuePage = (app: App) => {
  app.get("/issues/:id", async (c) => {
    const issueId = issueIdParam.parse(c.req.param("id"))
    const detail = await loadIssue(issueId)
    if (detail === null) {
      throw new HTTPException(404)
    }

    return reply.page(<IssuePage detail={detail} />, {
      title: `${detail.issue.projectKey}-${detail.issue.number} · Linear clone`,
      head: pageHead
    })
  })

  app.get("/issues/:id/live", async (c) => {
    const issueId = issueIdParam.parse(c.req.param("id"))
    const render = async () => event.patch(<IssuePageContent detail={await loadIssue(issueId)} />)

    async function* stream() {
      yield await render()

      for await (const _ of invalidations.subscribe(c.req.raw.signal)) {
        yield await render()
      }
    }

    return reply.stream(stream(), {
      heartbeat: { intervalMs: 15_000, comment: "issue-detail" }
    })
  })

  app.patch("/issues/:id", async (c) => {
    const issueId = issueIdParam.parse(c.req.param("id"))
    const parsedIssueUpdate = updateIssueSchema.safeParse(await c.req.parseBody())
    if (!parsedIssueUpdate.success) {
      return reply.done()
    }

    await updateIssue(issueId, parsedIssueUpdate.data)
    invalidations.publish()
    const issue = await loadIssueRecord(issueId)
    if (issue === null) {
      return reply.patch(<IssuePageContent detail={null} />)
    }
    return reply.patch(<IssueProperties issue={issue} />)
  })

  app.post("/issues/:id/comments", async (c) => {
    const issueId = issueIdParam.parse(c.req.param("id"))
    const user = c.get("user")
    const parsedComment = commentSchema.safeParse(await read.signals(c.req.raw))
    if (!parsedComment.success) {
      const { fieldErrors } = z.flattenError(parsedComment.error)
      return reply.signals(
        issueState.patch({
          _validation: {
            ...issueState.defaults._validation,
            commentBody: fieldErrors.commentBody?.[0] ?? ""
          }
        })
      )
    }

    await createComment(user, issueId, parsedComment.data.commentBody)
    invalidations.publish()
    return reply.stream([
      event.signals(issueState.reset()),
      event.patch(<IssueCommentsList comments={await loadIssueComments(issueId)} />)
    ])
  })
}
