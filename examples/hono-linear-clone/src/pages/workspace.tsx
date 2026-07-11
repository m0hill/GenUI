import { getCookie } from "hono/cookie"
import { event, read, reply, state, get, js, mod, post } from "datastar-kit"
import { z } from "zod"
import { pageHead, type App } from "../app.js"
import { deleteSessionCookie, deleteSession } from "../auth/session.js"
import { createIssue, readIssues, type Issue } from "../db/issue.js"
import { createProject, readProjects, type Project } from "../db/workspace.js"
import {
  issuePriorityValues,
  issueStatusValues,
  type IssuePriority,
  type IssueStatus,
  type User
} from "../db/schema.js"
import { invalidations } from "../realtime/hub.js"

const projectSchema = z.object({
  projectName: z.string().trim().min(2, "Name the project"),
  projectKey: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters")
    .max(8, "Keep keys short")
    .regex(/^[A-Z0-9]+$/i, "Use letters and numbers"),
  projectDescription: z.string().trim().max(240, "Keep it under 240 characters").optional()
})

const createIssueSchema = z.object({
  projectId: z.coerce.number().int().positive("Create a project first"),
  issueTitle: z.string().trim().min(3, "Write a clear title"),
  issueDescription: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
  issueStatus: z.enum(issueStatusValues),
  issuePriority: z.enum(issuePriorityValues)
})

const workspaceState = state({
  projectId: "",
  projectName: "",
  projectKey: "",
  projectDescription: "",
  issueTitle: "",
  issueDescription: "",
  issueStatus: "todo",
  issuePriority: "medium",
  modalOpen: false,
  _validation: {
    form: "",
    projectName: "",
    projectKey: "",
    issueTitle: ""
  }
})

export const issueStatuses: Array<{ value: IssueStatus; label: string; dotClass: string }> = [
  { value: "backlog", label: "Backlog", dotClass: "bg-border-strong" },
  { value: "todo", label: "Todo", dotClass: "bg-fg-secondary" },
  { value: "in_progress", label: "In Progress", dotClass: "bg-warning" },
  { value: "done", label: "Done", dotClass: "bg-success" },
  { value: "canceled", label: "Canceled", dotClass: "bg-danger" }
]

export const issuePriorities: Array<{ value: IssuePriority; label: string }> = [
  { value: "none", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" }
]

const Sidebar = (props: { user: User; projects: Project[] }) => (
  <aside
    id="sidebar"
    class="bg-surface border-r border-border text-fg-muted flex flex-col overflow-y-auto min-w-0 w-full"
  >
    <div class="h-15 px-4 border-b border-border flex items-center justify-between shrink-0">
      <div class="flex items-center gap-2 overflow-hidden">
        <span class="text-xs font-semibold text-fg-muted select-none">π</span>
        <span class="text-xs font-bold tracking-wider text-fg truncate">Linear Clone</span>
      </div>
      <span
        class="w-2 h-2 rounded-full bg-success"
        title="System operational"
      ></span>
    </div>

    <div class="p-3 border-b border-border-subtle shrink-0">
      <div class="flex items-center gap-2 text-[13px] text-fg-secondary px-2.5 py-2 bg-surface-inset border border-border rounded-lg">
        <span class="w-6 h-6 rounded-md bg-border flex items-center justify-center text-[10px] font-bold text-fg-secondary font-mono">
          {props.user.name.charAt(0).toUpperCase()}
        </span>
        <span class="truncate">{props.user.name}</span>
      </div>
    </div>

    <div class="flex-1 p-3 flex flex-col gap-6">
      <div class="flex flex-col gap-1">
        <h2 class="section-label px-2">Projects</h2>
        <ProjectList projects={props.projects} />
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="section-label px-2">New Project</h2>
        <form
          class="flex flex-col gap-3 px-2"
          data-on:submit={mod(post("/projects"), { prevent: true })}
        >
          <label class="flex flex-col gap-1.5 section-label">
            Name
            <input
              class="field"
              placeholder="Engineering"
              data-bind={workspaceState.refs.projectName}
            />
            <small
              class="text-danger text-[13px] font-medium min-h-4"
              data-text={workspaceState.refs._validation.projectName}
            ></small>
          </label>
          <label class="flex flex-col gap-1.5 section-label">
            Key
            <input
              class="field"
              placeholder="ENG"
              maxlength={8}
              data-bind={workspaceState.refs.projectKey}
            />
            <small
              class="text-danger text-[13px] font-medium min-h-4"
              data-text={workspaceState.refs._validation.projectKey}
            ></small>
          </label>
          <label class="flex flex-col gap-1.5 section-label">
            Description
            <textarea
              class="field"
              rows={2}
              data-bind={workspaceState.refs.projectDescription}
            ></textarea>
          </label>
          <button
            type="submit"
            class="btn-primary"
          >
            Create project
          </button>
        </form>
      </div>
    </div>

    <form
      method="post"
      action="/logout"
      class="p-3 border-t border-border bg-surface"
    >
      <button
        type="submit"
        class="btn w-full"
      >
        Sign out
      </button>
    </form>
  </aside>
)

const ProjectList = (props: { projects: Project[] }) => (
  <div class="flex flex-col gap-1">
    {props.projects.length === 0 ? (
      <p class="text-fg-muted text-[13px] px-2 py-2">Create a project to start tracking work.</p>
    ) : (
      props.projects.map((project) => (
        <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-fg-secondary hover:bg-surface-hover hover:text-fg transition-colors cursor-default">
          <span class="font-mono font-semibold text-fg text-[11px] min-w-8 bg-surface-inset border border-border px-1.5 py-0.5 rounded-md">
            {project.key}
          </span>
          <span class="truncate">{project.name}</span>
          <span class="ml-auto font-mono text-[11px] text-fg-muted bg-surface-inset border border-border px-1.5 py-0.5 rounded-md">
            {project.openIssues}
          </span>
        </div>
      ))
    )}
  </div>
)

const StatusLabel = ({ status }: { status: Issue["status"] }) => {
  const currentStatus = issueStatuses.find((x) => x.value === status)
  if (!currentStatus) return <span class="text-fg-muted">{status}</span>
  return (
    <span class="flex items-center gap-1.5 text-[11px] font-mono text-fg-secondary">
      <span class={`w-1.75 h-1.75 rounded-full ${currentStatus.dotClass}`}></span>
      {currentStatus.label}
    </span>
  )
}

const PriorityBadge = ({ priority }: { priority: Issue["priority"] }) => {
  const currentPriority = issuePriorities.find((x) => x.value === priority)
  if (!currentPriority) return null
  const color =
    priority === "urgent"
      ? "text-danger"
      : priority === "high"
        ? "text-warning"
        : priority === "medium"
          ? "text-fg-secondary"
          : priority === "low"
            ? "text-fg-muted"
            : "text-fg-muted/40"
  return (
    <span class={`text-[11px] font-mono font-semibold ${color}`}>
      {currentPriority.label.charAt(0).toUpperCase()}
    </span>
  )
}

const AssigneeCell = ({ name }: { name: string | null }) => {
  if (!name) return <span class="text-fg-muted/40">-</span>
  return (
    <span class="flex items-center gap-1.5 text-[11px] text-fg-secondary">
      <span class="w-5 h-5 rounded-full bg-border flex items-center justify-center text-[9px] font-bold text-fg-secondary font-mono">
        {name.charAt(0).toUpperCase()}
      </span>
      <span class="truncate">{name}</span>
    </span>
  )
}

export const Board = (props: { issues: Issue[] }) => (
  <section
    id="board"
    class="overflow-hidden rounded-lg border border-border bg-surface-card"
  >
    <div class="hidden md:grid grid-cols-[40px_100px_1fr_100px_60px_120px] gap-3 px-4 py-2 bg-surface border-b border-border text-[11px] font-bold tracking-widest uppercase text-fg-muted">
      <span></span>
      <span>ID</span>
      <span>Title</span>
      <span>Status</span>
      <span>Prio</span>
      <span>Assignee</span>
    </div>
    {props.issues.length === 0 ? (
      <div class="px-4 py-8">
        <p class="text-fg-muted text-[13px]">No issues yet. Create one above.</p>
      </div>
    ) : (
      props.issues.map((issue) => (
        <a
          href={`/issues/${issue.id}`}
          class="grid grid-cols-[24px_1fr_auto] gap-x-3 gap-y-2 px-3 py-3 border-b border-border-subtle items-center cursor-pointer transition-colors hover:bg-surface-card-hover md:grid-cols-[40px_100px_1fr_100px_60px_120px] md:gap-3 md:px-4 md:py-2.5"
          id={`issue-${issue.id}`}
        >
          <span
            class={`w-1.75 h-1.75 rounded-full ${
              issueStatuses.find((status) => status.value === issue.status)?.dotClass ?? "bg-border"
            }`}
          ></span>
          <span class="font-mono text-[11px] text-fg-muted tabular-nums bg-surface-inset border border-border px-1.5 py-0.5 rounded-md w-fit">
            {issue.projectKey}-{issue.number}
          </span>
          <span class="col-span-3 min-w-0 text-[13px] text-fg-secondary hover:text-fg md:col-span-1 md:truncate">
            {issue.title}
          </span>
          <div class="col-start-2 flex min-w-0 items-center gap-3 md:contents">
            <StatusLabel status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            <AssigneeCell name={issue.assigneeName} />
          </div>
        </a>
      ))
    )}
  </section>
)

export const IssueProjectSelect = (props: { projects: Project[] }) => (
  <select
    id="issue-project-select"
    class="field"
    data-bind={workspaceState.refs.projectId}
  >
    <option value="">Select project</option>
    {props.projects.map((project) => (
      <option value={project.id}>
        {project.key} · {project.name}
      </option>
    ))}
  </select>
)

const IssueModalForm = (props: { projects: Project[] }) => (
  <form
    class="bg-surface border border-border w-full max-w-130 flex flex-col gap-4 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
    data-on:submit={mod(post("/issues"), { prevent: true })}
    data-on:click={js`evt.stopPropagation()`}
  >
    <div class="flex items-center justify-between border-b border-border pb-3 -mx-5 px-5 -mt-1">
      <div class="flex items-center gap-2">
        <span class="text-xs text-fg-muted select-none">›</span>
        <h3 class="text-xs font-bold tracking-wider uppercase text-fg">Create Workspace Issue</h3>
      </div>
      <button
        type="button"
        class="btn h-8 w-8 p-0"
        data-on:click={js`${workspaceState.refs.modalOpen} = false`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <label class="flex flex-col gap-1.5 section-label">
      Title
      <input
        class="field"
        autofocus
        placeholder="Fix keyboard focus after creating an issue"
        data-bind={workspaceState.refs.issueTitle}
      />
      <small
        class="text-danger text-[13px] font-medium min-h-4"
        data-text={workspaceState.refs._validation.issueTitle}
      ></small>
    </label>
    <label class="flex flex-col gap-1.5 section-label">
      Description
      <textarea
        class="field"
        rows={3}
        placeholder="Add a description..."
        data-bind={workspaceState.refs.issueDescription}
      ></textarea>
    </label>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <label class="flex flex-col gap-1.5 section-label">
        Project
        <IssueProjectSelect projects={props.projects} />
        <small
          class="text-danger text-[13px] font-medium min-h-4"
          data-text={workspaceState.refs._validation.form}
        ></small>
      </label>
      <label class="flex flex-col gap-1.5 section-label">
        Status
        <select
          class="field"
          data-bind={workspaceState.refs.issueStatus}
        >
          {issueStatuses.map((status) => (
            <option value={status.value}>{status.label}</option>
          ))}
        </select>
      </label>
      <label class="flex flex-col gap-1.5 section-label">
        Priority
        <select
          class="field"
          data-bind={workspaceState.refs.issuePriority}
        >
          {issuePriorities.map((priority) => (
            <option value={priority.value}>{priority.label}</option>
          ))}
        </select>
      </label>
    </div>
    <div class="flex justify-end gap-2 pt-4 border-t border-border">
      <button
        type="button"
        class="btn"
        data-on:click={js`${workspaceState.refs.modalOpen} = false`}
      >
        Cancel
      </button>
      <button
        type="submit"
        class="btn-primary"
      >
        Create
      </button>
    </div>
  </form>
)

const IssueModal = (props: { projects: Project[] }) => (
  <dialog
    id="issue-modal"
    class="bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full border-0"
    data-effect={js`${workspaceState.refs.modalOpen} ? (!el.open && el.showModal()) : (el.open && el.close())`}
    data-on:click={js`if (evt.target === el) { ${workspaceState.refs.modalOpen} = false }`}
    data-on:close={js`${workspaceState.refs.modalOpen} = false`}
  >
    <div class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4">
      <div id="modal-content">
        <IssueModalForm projects={props.projects} />
      </div>
    </div>
  </dialog>
)

const Page = (props: { user: User; projects: Project[]; issues: Issue[] }) => (
  <main
    class="h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr] bg-bg overflow-hidden"
    data-signals={mod(workspaceState.defaults, { ifMissing: true })}
    data-init={get("/workspace/live")}
  >
    <div class="hidden lg:flex">
      <Sidebar
        user={props.user}
        projects={props.projects}
      />
    </div>
    <section class="overflow-hidden min-w-0 flex flex-col">
      <header class="h-15 border-b border-border flex items-center justify-between px-6 bg-surface/40 backdrop-blur-md shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-xs text-fg-muted select-none">›</span>
          <h2 class="text-[13px] font-semibold uppercase tracking-wide text-fg">Issues</h2>
        </div>
        <button
          type="button"
          class="btn-primary"
          data-on:click={get("/workspace/modal/issue")}
        >
          + Create Issue
        </button>
      </header>
      <div class="flex-1 overflow-auto p-5 lg:p-7">
        <Board issues={props.issues} />
        <IssueModal projects={props.projects} />
      </div>
    </section>
  </main>
)

export const registerWorkspacePage = (app: App) => {
  app.get("/workspace", async (c) => {
    const user = c.get("user")
    const [projects, issues] = await Promise.all([readProjects(), readIssues()])
    return reply.page(
      <Page
        user={user}
        projects={projects}
        issues={issues}
      />,
      {
        title: "Linear clone",
        head: pageHead
      }
    )
  })

  app.get("/workspace/live", async (c) => {
    const user = c.get("user")

    const render = async () => {
      const [projects, issues] = await Promise.all([readProjects(), readIssues()])
      return [
        event.patch(
          <Sidebar
            user={user}
            projects={projects}
          />
        ),
        event.patch(<Board issues={issues} />),
        event.patch(<IssueProjectSelect projects={projects} />)
      ]
    }

    async function* stream() {
      yield* await render()

      for await (const _ of invalidations.subscribe(c.req.raw.signal)) {
        yield* await render()
      }
    }

    return reply.stream(stream(), {
      heartbeat: { intervalMs: 15_000, comment: "linear-clone" }
    })
  })

  app.get("/workspace/modal/issue", async () => {
    const projects = await readProjects()
    return reply.stream([
      event.patch(<IssueProjectSelect projects={projects} />),
      event.signals(workspaceState.patch({ modalOpen: true }))
    ])
  })

  app.post("/projects", async (c) => {
    const parsedProject = projectSchema.safeParse(await read.signals(c.req.raw))
    if (!parsedProject.success) {
      const { fieldErrors } = z.flattenError(parsedProject.error)
      return reply.signals(
        workspaceState.patch({
          _validation: {
            ...workspaceState.defaults._validation,
            projectName: fieldErrors.projectName?.[0] ?? "",
            projectKey: fieldErrors.projectKey?.[0] ?? ""
          }
        })
      )
    }

    const project = await createProject(c.get("user"), parsedProject.data)
    if (project === null) {
      return reply.signals(
        workspaceState.patch({
          _validation: {
            ...workspaceState.defaults._validation,
            projectKey: "Project keys must be unique"
          }
        })
      )
    }

    invalidations.publish()
    const user = c.get("user")
    const projects = await readProjects()
    return reply.stream([
      event.signals(workspaceState.reset()),
      event.patch(
        <Sidebar
          user={user}
          projects={projects}
        />
      ),
      event.patch(<IssueProjectSelect projects={projects} />)
    ])
  })

  app.post("/issues", async (c) => {
    const parsedIssue = createIssueSchema.safeParse(await read.signals(c.req.raw))
    if (!parsedIssue.success) {
      const { fieldErrors } = z.flattenError(parsedIssue.error)
      return reply.signals(
        workspaceState.patch({
          _validation: {
            ...workspaceState.defaults._validation,
            form: fieldErrors.projectId?.[0] ?? "",
            issueTitle: fieldErrors.issueTitle?.[0] ?? ""
          }
        })
      )
    }

    const issue = await createIssue(c.get("user"), parsedIssue.data)
    invalidations.publish()
    return reply.stream([
      event.signals(workspaceState.reset()),
      event.navigate(`/issues/${issue.id}`)
    ])
  })

  app.post("/logout", async (c) => {
    await deleteSession(getCookie(c, "linear_session"))
    deleteSessionCookie(c)
    return c.redirect("/login")
  })
}
