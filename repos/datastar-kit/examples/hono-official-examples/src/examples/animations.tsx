import { Hono } from "hono"
import { event, reply, read, state, del, get, local, mod } from "datastar-kit"
import { z } from "zod"
import { ExampleLayout, pageHead } from "../layout.js"

const schema = z.object({ shouldRestore: z.boolean().default(false) })

const throbStates = [
  { fg: "#174ea6", bg: "#fff4cc", label: "blue on yellow" },
  { fg: "#8a2c0d", bg: "#ffe0b5", label: "brown on orange" },
  { fg: "#0f6b4f", bg: "#dff8ef", label: "green on mint" },
  { fg: "#6b2bbd", bg: "#f0e8ff", label: "purple on lavender" }
] as const

const Throb = ({ index }: { index: number }) => {
  const item = throbStates[index % throbStates.length] ?? throbStates[0]
  return (
    <div
      id="throb"
      class="animation-tile"
      style={`color: ${item.fg}; background-color: ${item.bg};`}
    >
      {item.label}
    </div>
  )
}

const ViewTransitionButton = ({ restored }: { restored: boolean }) => {
  const animationState = state({ shouldRestore: restored })
  const fetching = local<boolean>("vtFetching")

  return (
    <button
      id="view-transition"
      class={restored ? "success" : "info"}
      data-signals={mod(animationState.defaults, { ifMissing: true })}
      data-indicator={fetching}
      data-attr:disabled={fetching}
      data-on:click={get("/examples/animations/view_transition")}
    >
      {restored ? "Restored. Swap again." : "Swap It!"}
    </button>
  )
}

const fadeOutFetching = local<boolean>("fadeOutFetching")

const FadeOutButton = ({ fading = false }: { fading?: boolean }) => (
  <button
    id="fade-out-swap"
    class="warning"
    style={fading ? "transition: opacity 1s ease-out; opacity: 0" : undefined}
    disabled={fading}
    data-indicator={fadeOutFetching}
    data-attr:disabled={fadeOutFetching}
    data-on:click={del("/examples/animations")}
  >
    Fade out then delete on click
  </button>
)

const fadeInFetching = local<boolean>("fadeInFetching")

const FadeInButton = ({ invisible = false }: { invisible?: boolean }) => (
  <button
    id="fade-me-in"
    class="success"
    style={invisible ? "opacity: 0" : "transition: opacity 1s ease-out"}
    disabled={invisible}
    data-indicator={fadeInFetching}
    data-attr:disabled={fadeInFetching}
    data-on:click={get("/examples/animations/fade_me_in")}
  >
    Fade me in on click
  </button>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Animations"
      slug="animations"
      summary="Uses stable element ids, SSE patches, and view transitions for CSS-driven animation."
      source="https://data-star.dev/examples/animations"
    >
      <div class="stack">
        <section class="subdemo">
          <h2>Color Throb</h2>
          <div data-init={get("/examples/animations/throb")}>
            <Throb index={1} />
          </div>
        </section>
        <section class="subdemo">
          <h2>View Transitions</h2>
          <ViewTransitionButton restored={false} />
        </section>
        <section class="subdemo">
          <h2>Fade Out On Swap</h2>
          <FadeOutButton />
        </section>
        <section class="subdemo">
          <h2>Fade In On Addition</h2>
          <FadeInButton />
        </section>
      </div>
    </ExampleLayout>,
    {
      title: "Animations - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/throb", (c) =>
  reply.stream(
    (async function* () {
      let index = 0
      while (!c.req.raw.signal.aborted) {
        yield event.patch(<Throb index={index} />)
        index += 1
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    })(),
    { heartbeat: { intervalMs: 15_000, comment: "animations" } }
  )
)

example.get("/view_transition", async (c) => {
  const { shouldRestore } = schema.parse(await read.signals(c.req.raw))

  return reply.patch(<ViewTransitionButton restored={!shouldRestore} />, {
    useViewTransition: true
  })
})

example.delete("/", () =>
  reply.stream(
    (async function* () {
      yield event.patch(<FadeOutButton fading />)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      yield event.patch(<div id="fade-out-swap"></div>)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      yield event.patch(<FadeOutButton />)
    })()
  )
)

example.get("/fade_me_in", () =>
  reply.stream(
    (async function* () {
      yield event.patch(<FadeInButton invisible />)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      yield event.patch(<FadeInButton />)
    })()
  )
)
