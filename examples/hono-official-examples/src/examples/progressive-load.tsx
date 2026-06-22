import { Hono } from "hono"
import { event, reply, get, signal } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const LoadShell = () => (
  <div
    id="Load"
    class="progressive-content"
  >
    <header id="header"></header>
    <section id="article"></section>
    <section id="comments"></section>
    <div id="footer"></div>
  </div>
)

const Header = () => <header id="header">Welcome to my blog</header>

const Article = () => (
  <section id="article">
    <h4>This is my article</h4>
    <section id="articleBody"></section>
  </section>
)

const ArticleBody = () => (
  <section id="articleBody">
    <p>
      Each section can be patched as soon as the server has it. The article shell, body, comments,
      and footer all arrive independently over one event stream.
    </p>
  </section>
)

const Comments = () => (
  <section id="comments">
    <h5>Comments</h5>
    <p>This comments section is also filled progressively.</p>
    <ul
      id="comments-list"
      class="comments-list"
    ></ul>
  </section>
)

const Comment = ({ id, name }: { id: number; name: string }) => (
  <li id={`${id}`}>
    <img
      src={`https://avatar.iran.liara.run/username?username=${encodeURIComponent(name)}`}
      alt="Avatar"
    />
    <span>{name} liked the progressive load.</span>
  </li>
)

const Footer = () => <div id="footer">Hope you like it.</div>
const progressiveLoad = signal<boolean>("progressiveLoad")

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Progressive Load"
      slug="progressive_load"
      summary="Streams independent page sections as they become available."
      source="https://data-star.dev/examples/progressive_load"
    >
      <div class="stack">
        <div class="actions">
          <button
            id="load-button"
            class="info"
            data-indicator={progressiveLoad}
            data-attr:disabled={progressiveLoad}
            data-on:click={get("/examples/progressive_load/updates")}
          >
            Load
          </button>
          <span
            class="muted"
            data-show={progressiveLoad}
          >
            Loading sections...
          </span>
        </div>
        <p>Each part is loaded randomly and progressively.</p>
        <LoadShell />
      </div>
    </ExampleLayout>,
    {
      title: "Progressive Load - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/updates", () =>
  reply.stream(
    (async function* () {
      yield event.patch(<LoadShell />)

      for (const section of [<Header />, <Article />, <Comments />, <Footer />].toSorted(
        () => Math.random() - 0.5
      )) {
        await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 350))
        yield event.patch(section)
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
      yield event.patch(<ArticleBody />)

      for (const [index, name] of ["Ada Lovelace", "Grace Hopper", "Katherine Johnson"].entries()) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        yield event.patch(
          <Comment
            id={index + 1}
            name={name}
          />,
          {
            selector: "#comments-list",
            mode: "append"
          }
        )
      }
    })()
  )
)
