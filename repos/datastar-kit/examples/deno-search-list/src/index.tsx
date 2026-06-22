import { route, type Route } from "@std/http/unstable-route"
import { event, read, reply, state, get, mod, post } from "datastar-kit"
import { z } from "zod"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

interface Item {
  id: number
  name: string
}

let nextItemId = 7

const items: Item[] = [
  { id: 1, name: "Deno handbook" },
  { id: 2, name: "Tailwind patterns" },
  { id: 3, name: "Datastar examples" },
  { id: 4, name: "Server-rendered views" },
  { id: 5, name: "Search shortcuts" },
  { id: 6, name: "Release checklist" }
]

const listState = state({ query: "", name: "" })

const ListSignals = z.object({
  query: z.string().optional().default(""),
  name: z.string().optional().default("")
})

const ItemRow = (props: { item: Item }) => (
  <li
    id={`item-${props.item.id}`}
    class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm"
  >
    {props.item.name}
  </li>
)

const ItemList = (props: { items: Item[] }) => (
  <ul
    id="item-list"
    class="mt-4 grid gap-2"
  >
    {props.items.length === 0 ? (
      <li
        id="empty-state"
        class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500"
      >
        No matching items.
      </li>
    ) : (
      props.items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
        />
      ))
    )}
  </ul>
)

const routes: Route[] = [
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/" }),
    handler: () =>
      reply.page(
        <main
          class="min-h-screen bg-slate-100 px-6 py-12"
          data-signals={mod(listState.defaults, { ifMissing: true })}
        >
          <section class="mx-auto max-w-2xl">
            <div>
              <p class="text-sm font-medium uppercase tracking-wide text-blue-700">
                Deno + Datastar Kit
              </p>
              <h1 class="mt-2 text-3xl font-semibold text-slate-950">Searchable list</h1>
              <p class="mt-2 text-slate-600">
                Search the current list, then add a new item with an append patch.
              </p>
            </div>

            <div class="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <input
                class="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-950 outline-none focus:border-blue-600"
                placeholder="Search items"
                data-bind={listState.refs.query}
                data-on:input={mod(get("/items/search"), { debounce: "200ms" })}
              />

              <form
                class="mt-3 flex gap-2"
                data-on:submit={mod(post("/items"), { prevent: true })}
              >
                <input
                  class="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-slate-950 outline-none focus:border-blue-600"
                  placeholder="New item"
                  data-bind={listState.refs.name}
                />
                <button
                  type="submit"
                  class="rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
                >
                  Add
                </button>
              </form>
            </div>

            <ItemList items={items} />
          </section>
        </main>,
        {
          title: "Deno searchable list",
          head: [
            <script
              key="datastar"
              type="module"
              src={DATASTAR_RUNTIME}
            />,
            <script
              key="tailwind"
              src="https://cdn.tailwindcss.com"
            />
          ]
        }
      )
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/items/search" }),
    handler: async (request) => {
      const signals = ListSignals.parse(await read.signals(request))
      const query = signals.query.trim().toLowerCase()
      const results =
        query.length === 0 ? items : items.filter((item) => item.name.toLowerCase().includes(query))

      return reply.patch(<ItemList items={results} />)
    }
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/items" }),
    handler: async (request) => {
      const signals = ListSignals.parse(await read.signals(request))
      const itemName = signals.name.trim()

      if (itemName.length === 0) {
        return reply.signals(listState.patch({ name: "" }))
      }

      const item = { id: nextItemId, name: itemName }
      nextItemId += 1
      items.push(item)

      if (!item.name.toLowerCase().includes(signals.query.trim().toLowerCase())) {
        return reply.signals(listState.patch({ name: "" }))
      }

      return reply.stream([
        event.patch("", { selector: "#empty-state", mode: "remove" }),
        event.patch(<ItemRow item={item} />, { selector: "#item-list", mode: "append" }),
        event.signals(listState.patch({ name: "" }))
      ])
    }
  }
]

Deno.serve(
  { port: 3000 },
  route(routes, () => new Response("Not Found", { status: 404 }))
)
