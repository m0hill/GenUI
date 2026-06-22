export interface NavLink {
  text: string
  path: string
}

export interface NavGroup {
  text: string
  items: NavLink[]
}

export const sidebar: NavGroup[] = [
  {
    text: "Overview",
    items: [{ text: "Introduction", path: "/docs/introduction" }]
  },
  {
    text: "Concepts",
    items: [
      { text: "Programming model", path: "/docs/concepts/programming-model" },
      { text: "Runtime boundaries", path: "/docs/concepts/runtime-boundaries" }
    ]
  },
  {
    text: "Guides",
    items: [
      { text: "HTML and JSX", path: "/docs/guides/html-and-jsx" },
      { text: "Signals", path: "/docs/guides/signals" },
      { text: "Actions and responses", path: "/docs/guides/actions-and-responses" },
      { text: "Element patches", path: "/docs/guides/patch-elements" },
      { text: "Validation", path: "/docs/guides/validation-and-errors" },
      { text: "Realtime", path: "/docs/guides/realtime" },
      { text: "Debugger", path: "/docs/guides/debugger" }
    ]
  },
  {
    text: "Operations",
    items: [
      { text: "Security", path: "/docs/guides/security" },
      { text: "Deployment", path: "/docs/guides/deployment" },
      { text: "Testing", path: "/docs/guides/testing" }
    ]
  },
  {
    text: "Reference",
    items: [
      { text: "API", path: "/docs/reference/api" },
      { text: "Examples", path: "/docs/guides/examples" },
      { text: "Agent setup", path: "/docs/guides/agent" }
    ]
  }
]

export const flatNav: NavLink[] = sidebar.flatMap((group) => group.items)
