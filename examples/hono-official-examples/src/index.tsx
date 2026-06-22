import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { reply } from "datastar-kit"
import { Shell, pageHead } from "./layout.js"
import { example as activeSearch } from "./examples/active-search.js"
import { example as animations } from "./examples/animations.js"
import { example as badApple } from "./examples/bad-apple.js"
import { example as bulkUpdate } from "./examples/bulk-update.js"
import { example as clickToEdit } from "./examples/click-to-edit.js"
import { example as clickToLoad } from "./examples/click-to-load.js"
import { example as customEvent } from "./examples/custom-event.js"
import { example as customPlugin } from "./examples/custom-plugin.js"
import { example as dbmon } from "./examples/dbmon.js"
import { example as deleteRow } from "./examples/delete-row.js"
import { example as editRow } from "./examples/edit-row.js"
import { example as eventBubbling } from "./examples/event-bubbling.js"
import { example as fileUpload } from "./examples/file-upload.js"
import { example as formData } from "./examples/form-data.js"
import { example as infiniteScroll } from "./examples/infinite-scroll.js"
import { example as inlineValidation } from "./examples/inline-validation.js"
import { example as lazyLoad } from "./examples/lazy-load.js"
import { example as lazyTabs } from "./examples/lazy-tabs.js"
import { example as onSignalPatch } from "./examples/on-signal-patch.js"
import { example as progressBar } from "./examples/progress-bar.js"
import { example as progressiveLoad } from "./examples/progressive-load.js"
import { example as sortable } from "./examples/sortable.js"
import { example as svgMorphing } from "./examples/svg-morphing.js"
import { example as counters } from "./examples/counters.js"
import { example as titleUpdate } from "./examples/title-update.js"
import { example as todomvc } from "./examples/todomvc.js"
import { example as webComponent } from "./examples/web-component.js"

const app = new Hono()

export const indexPage = (): Response =>
  reply.page(
    <Shell title="Official Datastar Examples">
      <section class="panel">
        <p>This app implements all official Datastar examples using Datastar Kit.</p>
      </section>
    </Shell>,
    {
      title: "Official Datastar Examples",
      head: pageHead()
    }
  )

app.use(
  "/public/*",
  serveStatic({
    root: fileURLToPath(new URL("../", import.meta.url)),
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-store")
    }
  })
)

app.get("/", () => indexPage())

app.route("/examples/active_search", activeSearch)
app.route("/examples/animations", animations)
app.route("/examples/bad_apple", badApple)
app.route("/examples/bulk_update", bulkUpdate)
app.route("/examples/click_to_edit", clickToEdit)
app.route("/examples/click_to_load", clickToLoad)
app.route("/examples/custom_event", customEvent)
app.route("/examples/custom_plugin", customPlugin)
app.route("/examples/dbmon", dbmon)
app.route("/examples/delete_row", deleteRow)
app.route("/examples/edit_row", editRow)
app.route("/examples/event_bubbling", eventBubbling)
app.route("/examples/file_upload", fileUpload)
app.route("/examples/form_data", formData)
app.route("/examples/infinite_scroll", infiniteScroll)
app.route("/examples/inline_validation", inlineValidation)
app.route("/examples/lazy_load", lazyLoad)
app.route("/examples/lazy_tabs", lazyTabs)
app.route("/examples/on_signal_patch", onSignalPatch)
app.route("/examples/progress_bar", progressBar)
app.route("/examples/progressive_load", progressiveLoad)
app.route("/examples/sortable", sortable)
app.route("/examples/svg_morphing", svgMorphing)
app.route("/examples/counters", counters)
app.route("/examples/title_update", titleUpdate)
app.route("/examples/todomvc", todomvc)
app.route("/examples/web_component", webComponent)

app.notFound((c) => c.text("Not Found", 404))

const port = Number(process.env.PORT ?? "3000")
serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono official Datastar examples listening on http://localhost:${port}`)
})
