import { Hono } from "hono"
import { reply, get } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const tabText = [
  "Sed laudantium non eum nobis facere. Est repudiandae consectetur debitis et libero. Fuga facilis id sapiente possimus minus. Dignissimos et iusto error deserunt officiis. Molestiae maiores aut natus est praesentium. Rerum ut quod voluptatem officia animi. Minus asperiores ipsam ut vel sit. Debitis quam iusto ipsa et non. Autem modi dolorem nobis temporibus nisi.",
  "Vero quod ducimus dolore est eveniet.",
  "Quisquam quos illo doloremque dolorem cumque. Dolorem ut officia iste omnis dolores. Delectus suscipit aperiam mollitia rerum aut. Molestiae labore quo quaerat aliquid id. Neque similique nesciunt suscipit voluptas voluptatum. In eveniet ab ea sint minima. Odio aliquid suscipit temporibus dolor illo. Est voluptate sit aut doloremque et.",
  "Nesciunt consectetur molestiae aut enim veniam. Alias excepturi fuga dolor quia pariatur. Et laborum rerum dicta repudiandae voluptate. Possimus ut velit omnis laudantium eos. Fuga aliquam soluta cum reiciendis quas.",
  "At quae aut eligendi qui sed. Et culpa commodi et eos repellat. Eius harum qui amet accusantium incidunt. Sunt doloremque dolor fuga nisi quas. Alias molestiae at qui est atque. Dolore eos sequi illo quam officia. Molestias dignissimos et magni ab cupiditate. Modi voluptas labore quae nam rerum. Reprehenderit incidunt velit ducimus eius ut. Dolore natus quam quaerat et amet.",
  "Ut maiores impedit et magnam nostrum. Quisquam eligendi itaque impedit ut perferendis.",
  "Est non animi enim saepe consequuntur. Sint ut delectus dolor quos vero. Aut quia nisi quos neque sit. Quia veritatis ea quam quis qui. Reiciendis molestias cupiditate ut est modi. Et quis autem velit voluptatem aut.",
  "Veritatis dolores velit natus ipsa et."
]

const LazyTabs = ({ active }: { active: number }) => (
  <div id="lazy-tabs">
    <div role="tablist">
      {tabText.map((_, index) => (
        <button
          role="tab"
          aria-selected={index === active ? "true" : "false"}
          data-on:click={get(`/examples/lazy_tabs/${index}`)}
        >
          Tab {index}
        </button>
      ))}
    </div>
    <div role="tabpanel">
      <p>{tabText[active]}</p>
    </div>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Lazy Tabs"
      slug="lazy_tabs"
      summary="Fetches tab panel content only when a tab is selected."
      source="https://data-star.dev/examples/lazy_tabs"
    >
      <LazyTabs active={0} />
    </ExampleLayout>,
    {
      title: "Lazy Tabs - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/:index", (c) => {
  const rawIndex = c.req.param("index")
  const index = Number(rawIndex)

  if (!Number.isInteger(index)) {
    return c.text(`error parsing index: ${rawIndex}`, 400)
  }

  if (index < 0 || index >= tabText.length) {
    return c.text(`invalid index: ${rawIndex}`, 400)
  }

  return reply.patch(<LazyTabs active={index} />)
})
