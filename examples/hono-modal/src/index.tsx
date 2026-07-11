import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { event, reply, get, js, mod, post, signal } from "datastar-kit"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const openModal = signal<boolean, "modalOpen">("modalOpen")
const app = new Hono()

app.use("/static/*", serveStatic({ root: fileURLToPath(new URL("../", import.meta.url)) }))

app.get("/", () =>
  reply.page(
    <main
      id="app"
      data-signals={mod({ modalOpen: false }, { ifMissing: true })}
    >
      <h1>Datastar modal</h1>
      <p>
        This example patches a native <code>&lt;dialog&gt;</code> into a modal slot from a Hono
        route, then uses a Datastar signal and <code>data-effect</code> to call{" "}
        <code>showModal()</code> and <code>close()</code>.
      </p>

      <div class="row">
        <button
          type="button"
          class="primary"
          data-on:click={get("/modal")}
        >
          Open server-rendered modal
        </button>
      </div>

      <div id="modal-slot"></div>
      <p
        id="last-action"
        class="result"
      >
        No modal action yet.
      </p>
    </main>,
    {
      title: "Datastar Hono modal",
      head: [
        <link
          rel="stylesheet"
          href="/static/styles.css"
        />,
        <script
          type="module"
          src={DATASTAR_RUNTIME}
        />
      ]
    }
  )
)

app.get("/modal", () =>
  reply.stream([
    event.patch(
      <dialog
        id="confirm-modal"
        aria-labelledby="confirm-modal-title"
        data-effect={js`${openModal} ? (!el.open && el.showModal()) : (el.open && el.close())`}
        data-on:click={js`if (evt.target === el) { ${openModal} = false }`}
        data-on:close={js`${openModal} = false`}
      >
        <section class="modal">
          <h2 id="confirm-modal-title">Confirm the action</h2>
          <p>
            The modal itself came from the server. The open/closed state is a Datastar signal, so
            Escape, backdrop clicks, and buttons all stay in sync.
          </p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary"
              data-on:click={js`${openModal} = false`}
            >
              Cancel
            </button>
            <button
              type="button"
              class="danger"
              data-on:click={post("/modal/confirm")}
            >
              Confirm
            </button>
          </div>
        </section>
      </dialog>,
      { selector: "#modal-slot", mode: "inner" }
    ),
    event.signals({ modalOpen: true })
  ])
)

app.post("/modal/confirm", () =>
  reply.stream([
    event.signals({ modalOpen: false }),
    event.patch(
      <p
        id="last-action"
        class="result"
      >
        Confirmed at {new Date().toLocaleTimeString()}.
      </p>
    )
  ])
)

app.notFound((c) => c.text("Not Found", 404))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log("Hono modal listening on http://localhost:3000")
})
