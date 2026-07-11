# HTML and JSX

Datastar Kit renders HTML on the server. TSX is an authoring convenience over a small HTML node model; it is not a browser component runtime, virtual DOM, or hydration system.

Use TSX for application views. Use the low-level HTML helpers when you are writing tests, generators, or non-JSX code.

## Setup

Configure TypeScript's automatic JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "datastar-kit"
  }
}
```

Then write synchronous view functions:

```tsx
import { renderToString, post } from "datastar-kit"

const SaveButton = () => (
  <button
    type="button"
    data-on:click={post("/settings/save")}
  >
    Save
  </button>
)

const html = renderToString(<SaveButton />)
```

View functions receive data and return HTML. Load data in handlers or route loaders before rendering.

## Datastar attributes

TSX can use native Datastar attribute names directly. Datastar Kit's JSX runtime serializes signal
refs, expressions, action helpers, and object-valued signal maps for `data-*` attributes:

```tsx
import { mod, post, state } from "datastar-kit"

const login = state({
  password: "",
  _validation: { password: "" }
})

const LoginForm = () => (
  <form
    data-signals={mod(login.defaults, { ifMissing: true })}
    data-on:submit={mod(post("/login"), { prevent: true })}
  >
    <input
      type="password"
      data-bind={login.refs.password}
    />
    <small
      data-show={login.refs._validation.password}
      data-text={login.refs._validation.password}
    />
  </form>
)
```

String values stay raw, so ordinary HTML and hand-written Datastar expressions still render exactly
as written. When a Datastar attribute needs modifiers, wrap the value with `mod(value, modifiers)`, such as
`data-on:input={mod(get("/search"), { debounce: "200ms" })}`.

Some Datastar attributes are plain string attributes rather than expression-valued attributes.
For example, `data-preserve-attr` expects a space-separated list of HTML attribute names. Use
`preserve(...)` to build that list without accidentally serializing an array expression:

```tsx
import { preserve } from "datastar-kit"
;<details
  open
  data-preserve-attr={preserve("open", "class")}
>
  <summary>Filters</summary>
  ...
</details>
```

## Typed attributes and autocomplete

Intrinsic elements have typed common attributes. Your editor autocompletes HTML tag names,
per-tag HTML attributes (`<input accept maxlength>`, `<form method enctype>`, ...), ARIA
attributes, and every Datastar attribute. Known attribute values are checked too: `data-bind`
expects a signal ref or name, `data-show` expects an expression, `data-signals` expects a signal
object, and `<button type="...">` only accepts real button types.

Keyed Datastar attributes are typed through template patterns, so `data-on:click` and common event
names are suggested while custom events such as `data-on:widget-loaded` still type-check.

Escape hatches keep server-side JSX flexible:

- Unknown attributes on known tags are accepted for custom, vendor, and future HTML attributes.
- Unknown tags (custom elements such as `<my-widget>`, and anything else) accept loosely typed
  props, so any attribute the runtime can serialize is allowed.
- Unrecognized `data-*` and `aria-*` attributes are always accepted on every element.

```tsx
<my-widget
  theme="dark"
  data-on:widget-loaded={js`${ready} = true`}
>
  <svg viewBox="0 0 10 10">
    <circle
      cx={5}
      cy={5}
      r={4}
      data-show={ready}
    />
  </svg>
</my-widget>
```

## Pages

`reply.page(...)` renders a full HTML document and returns a native `Response`:

```tsx
import { reply } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const ProjectsPage = (props: { projects: Project[] }) => (
  <main id="page">
    <h1>Projects</h1>
    <ProjectList projects={props.projects} />
  </main>
)

return reply.page(<ProjectsPage projects={projects} />, {
  title: "Projects",
  head: (
    <script
      type="module"
      src={DATASTAR_RUNTIME}
    />
  )
})
```

`title` renders a document `<title>`. `head` accepts one node or an array of nodes.

## Layouts

Layouts are plain functions. Put shared shell markup, navigation, scripts, and stable patch targets in the layout, then pass page-specific content through `children`.

```tsx
import type { HtmlChild } from "datastar-kit"

interface AppLayoutProps {
  title: string
  children?: HtmlChild
}

const AppLayout = (props: AppLayoutProps) => (
  <div id="app">
    <header>
      <a href="/">Acme</a>
      <nav>
        <a href="/projects">Projects</a>
        <a href="/settings">Settings</a>
      </nav>
    </header>

    <main id="page">
      <h1>{props.title}</h1>
      {props.children}
    </main>
  </div>
)

const ProjectsPage = (props: { projects: Project[] }) => (
  <AppLayout title="Projects">
    <ProjectList projects={props.projects} />
  </AppLayout>
)
```

For named regions such as sidebars, breadcrumbs, and toolbars, use normal props typed as `HtmlChild`:

```tsx
interface DashboardLayoutProps {
  title: string
  sidebar?: HtmlChild
  toolbar?: HtmlChild
  children?: HtmlChild
}

const DashboardLayout = (props: DashboardLayoutProps) => (
  <main id="dashboard">
    <aside id="sidebar">{props.sidebar}</aside>
    <section id="dashboard-main">
      <header>
        <h1>{props.title}</h1>
        <div class="toolbar">{props.toolbar}</div>
      </header>
      <div id="dashboard-content">{props.children}</div>
    </section>
  </main>
)
```

Those layout IDs can become patch boundaries:

```tsx
return reply.patch(<ProjectList projects={projects} />, {
  selector: "#dashboard-content",
  mode: "inner"
})
```

## Data loading

Keep I/O out of JSX. Handlers should load data, handle auth and errors, then render the view.

```tsx
async function loadDashboard(request: Request) {
  const user = await requireUser(request)

  const [projects, notifications] = await Promise.all([
    db.projects.forUser(user.id),
    db.notifications.forUser(user.id)
  ])

  return { user, projects, notifications }
}

export async function dashboardRoute(request: Request): Promise<Response> {
  const data = await loadDashboard(request)

  return reply.page(
    <DashboardLayout
      title="Dashboard"
      sidebar={<Sidebar user={data.user} />}
    >
      <ProjectList projects={data.projects} />
      <Notifications items={data.notifications} />
    </DashboardLayout>,
    { title: "Dashboard" }
  )
}
```

Avoid async JSX components:

```tsx
// Avoid: I/O hidden inside rendering.
const Dashboard = async () => <main>{await loadSomething()}</main>
```

If a region is slow or live, render a shell and patch that region separately:

```tsx
const DashboardShell = () => (
  <DashboardLayout title="Dashboard">
    <section
      id="stats"
      data-init={get("/dashboard/stats")}
    >
      Loading stats...
    </section>
  </DashboardLayout>
)

export async function statsRoute(): Promise<Response> {
  const stats = await loadStats()
  return reply.patch(<StatsPanel stats={stats} />)
}
```

## Escaping

Text and attribute values are escaped by default.

Use `unsafeHtml(...)` only for HTML that has already crossed your application's trust boundary, such as sanitized Markdown output or trusted renderer output.

```tsx
import { unsafeHtml } from "datastar-kit"

const body = unsafeHtml(sanitizedHtml)
```

## Rendering to a string

Use `renderToString(...)` when you need serialized HTML outside a response helper:

```tsx
import { renderToString, post } from "datastar-kit"

const html = renderToString(
  <button
    type="button"
    data-on:click={post("/save")}
  >
    Save
  </button>
)
```

Next: [Signals](signals.md).
