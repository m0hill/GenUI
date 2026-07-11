import { Hono } from "hono"
import { reply, state, js, local, mod } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const componentState = state({ _name: "Your Name" })
const reversed = local<string>("reversed")

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Web Component"
      slug="web_component"
      summary="Keeps a custom element attribute synchronized from a Datastar signal."
      source="https://data-star.dev/examples/web_component"
    >
      <div
        class="stack"
        data-signals={mod(componentState.defaults, { ifMissing: true })}
      >
        <label>
          Reversed
          <input
            type="text"
            data-bind={componentState.refs._name}
          />
        </label>
        <span
          data-signals={{ [reversed.name]: "" }}
          data-text={reversed}
        ></span>
        <reverse-component
          data-on:reverse={js`${reversed} = evt.detail.value`}
          data-attr:name={componentState.refs._name}
        ></reverse-component>
      </div>
    </ExampleLayout>,
    {
      title: "Web Component - Datastar Kit",
      head: pageHead(
        <script
          type="module"
          src="/public/reverse-component.js"
        />
      )
    }
  )
)
