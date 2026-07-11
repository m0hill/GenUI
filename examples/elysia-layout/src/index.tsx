import { staticPlugin } from "@elysia/static"
import { Elysia } from "elysia"
import { event, read, reply, type HtmlChild, state, mod, post } from "datastar-kit"
import { z } from "zod"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const projectForm = state({ title: "" })

interface Project {
  id: number
  title: string
  owner: string
  status: string
  summary: string
}

let nextProjectId = 4

const projects: Project[] = [
  {
    id: 1,
    title: "Design the onboarding flow",
    owner: "Ada",
    status: "In review",
    summary: "Map the first-run screens, empty states, and activation checklist."
  },
  {
    id: 2,
    title: "Ship the dashboard shell",
    owner: "Grace",
    status: "In progress",
    summary: "Build the sidebar, topbar, and project list regions."
  },
  {
    id: 3,
    title: "Document Datastar patches",
    owner: "Linus",
    status: "Planned",
    summary: "Write examples for patching stable regions and clearing signals."
  }
]

const DashboardLayout = (props: { title: string; toolbar?: HtmlChild; children?: HtmlChild }) => (
  <div
    class="shell"
    data-signals={mod(projectForm.defaults, { ifMissing: true })}
  >
    <aside class="sidebar">
      <strong>Datastar Kit</strong>
      <nav>
        <a href="/">Projects</a>
        <a href="https://data-star.dev/">Datastar docs</a>
        <a href="https://elysiajs.com/">Elysia docs</a>
      </nav>
    </aside>

    <main class="content">
      <header class="topbar">
        <div>
          <p class="muted">Elysia + Bun layout example</p>
          <h1>{props.title}</h1>
        </div>
        {props.toolbar}
      </header>

      <section id="page-content">{props.children}</section>
    </main>
  </div>
)

const pageOptions = (title: string) => ({
  title,
  head: [
    <script
      type="module"
      src={DATASTAR_RUNTIME}
    />,
    <link
      rel="stylesheet"
      href="/public/styles.css"
    />
  ]
})

const ProjectList = (props: { projects: Project[] }) => (
  <section
    id="project-list"
    class="card"
  >
    <h2>Projects</h2>
    {props.projects.length === 0 ? (
      <p class="muted">No projects yet.</p>
    ) : (
      props.projects.map((project) => (
        <article
          class="project"
          id={`project-${project.id}`}
        >
          <div>
            <a href={`/projects/${project.id}`}>{project.title}</a>
            <p class="muted">{project.summary}</p>
          </div>
          <span class="muted">{project.status}</span>
        </article>
      ))
    )}
  </section>
)

export const app = new Elysia()
  .use(staticPlugin())
  .get("/", () =>
    reply.page(
      <DashboardLayout
        title="Projects"
        toolbar={
          <form
            class="toolbar"
            data-on:submit={mod(post("/projects"), { prevent: true })}
          >
            <input
              placeholder="New project title"
              data-bind={projectForm.refs.title}
            />
            <button>Add project</button>
          </form>
        }
      >
        <ProjectList projects={projects} />
      </DashboardLayout>,
      pageOptions("Elysia layout example")
    )
  )
  .get("/projects/:id", ({ params }) => {
    const project = projects.find((item) => item.id === Number(params.id))

    if (project === undefined) {
      return reply.page(
        <DashboardLayout title="Project not found">
          <section class="card">
            <p class="muted">No project exists for this URL.</p>
            <a href="/">Back to projects</a>
          </section>
        </DashboardLayout>,
        pageOptions("Project not found"),
        { status: 404 }
      )
    }

    return reply.page(
      <DashboardLayout title={project.title}>
        <section class="card">
          <p class="muted">Owner</p>
          <p>{project.owner}</p>

          <p class="muted">Status</p>
          <p>{project.status}</p>

          <p class="muted">Summary</p>
          <p>{project.summary}</p>

          <a href="/">Back to projects</a>
        </section>
      </DashboardLayout>,
      pageOptions(project.title)
    )
  })
  .post("/projects", async ({ request }) => {
    const signals = z.object({ title: z.string() }).parse(await read.signals(request))
    const projectTitle = signals.title.trim()

    if (projectTitle.length > 0) {
      projects.unshift({
        id: nextProjectId,
        title: projectTitle,
        owner: "You",
        status: "New",
        summary: "New project created from the dashboard."
      })
      nextProjectId += 1
    }

    return reply.stream([
      event.patch(<ProjectList projects={projects} />),
      event.signals(projectForm.reset())
    ])
  })

app.listen(3000)
console.log("Elysia layout example listening on http://localhost:3000")
