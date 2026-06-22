import { Hono } from "hono"
import { event, reply, get, local } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const colors = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
  "magenta",
  "lime",
  "teal",
  "indigo"
] as const

const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min

const color = () => colors[randomInt(0, colors.length - 1)] ?? colors[0]

const ColorSvg = ({ fill = "red" }: { fill?: string }) => (
  <svg
    id="circle-demo"
    viewBox="0 0 100 100"
    class="morph-svg"
  >
    <circle
      cx="50"
      cy="50"
      r="40"
      fill={fill}
    ></circle>
  </svg>
)

const SizeSvg = ({ radius = 30 }: { radius?: number }) => (
  <svg
    id="size-demo"
    viewBox="0 0 100 100"
    class="morph-svg"
  >
    <circle
      cx="50"
      cy="50"
      r={radius}
      fill="green"
    ></circle>
  </svg>
)

const ShapeSvg = ({ variant = 0 }: { variant?: number }) => (
  <svg
    id="shape-demo"
    viewBox="0 0 100 100"
    class="morph-svg"
  >
    {variant % 5 === 0 ? (
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="purple"
      ></circle>
    ) : variant % 5 === 1 ? (
      <rect
        x="20"
        y="20"
        width="60"
        height="60"
        fill="purple"
      ></rect>
    ) : variant % 5 === 2 ? (
      <ellipse
        cx="50"
        cy="50"
        rx="45"
        ry="30"
        fill="purple"
      ></ellipse>
    ) : variant % 5 === 3 ? (
      <polygon
        points="50,15 85,75 15,75"
        fill="purple"
      ></polygon>
    ) : (
      <polygon
        points="30,30 70,30 80,50 70,70 30,70 20,50"
        fill="purple"
      ></polygon>
    )}
  </svg>
)

const MultiSvg = ({ randomize = false }: { randomize?: boolean }) => {
  const circles = randomize
    ? [
        { cx: 30, cy: 30, r: randomInt(10, 29), fill: color() },
        { cx: 70, cy: 30, r: randomInt(10, 29), fill: color() },
        { cx: 50, cy: 70, r: randomInt(10, 29), fill: color() }
      ]
    : [
        { cx: 30, cy: 30, r: 15, fill: "red" },
        { cx: 70, cy: 30, r: 15, fill: "blue" },
        { cx: 50, cy: 70, r: 15, fill: "green" }
      ]

  return (
    <svg
      id="multi-demo"
      viewBox="0 0 100 100"
      class="morph-svg"
    >
      {circles.map((circle) => (
        <circle
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          fill={circle.fill}
        ></circle>
      ))}
    </svg>
  )
}

const AnimatedSvg = ({ radius = 20, fill = "green" }: { radius?: number; fill?: string }) => (
  <svg
    id="animated-demo"
    viewBox="0 0 100 100"
    class="morph-svg"
  >
    <circle
      cx="50"
      cy="50"
      r={radius}
      fill={fill}
    ></circle>
  </svg>
)

const fetching = local<boolean>("fetching")

const SvgMorphingDemo = () => (
  <div class="grid morph-grid">
    <section class="subdemo">
      <ColorSvg />
      <button
        class="info"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/svg_morphing/circle_color")}
      >
        Change Color
      </button>
    </section>
    <section class="subdemo">
      <SizeSvg />
      <button
        class="info"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/svg_morphing/circle_size")}
      >
        Change Radius
      </button>
    </section>
    <section class="subdemo">
      <ShapeSvg />
      <button
        class="info"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/svg_morphing/shape_transform")}
      >
        Random Shape
      </button>
    </section>
    <section class="subdemo">
      <MultiSvg />
      <button
        class="info"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/svg_morphing/multiple_elements")}
      >
        Randomize All Circles
      </button>
    </section>
    <section class="subdemo">
      <AnimatedSvg />
      <button
        class="success"
        data-indicator={fetching}
        data-attr:disabled={fetching}
        data-on:click={get("/examples/svg_morphing/animated_morph")}
      >
        Start Animation Sequence
      </button>
    </section>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="SVG Morphing"
      slug="svg_morphing"
      summary="Patches stable SVG ids so Datastar morphs vector elements in place."
      source="https://data-star.dev/examples/svg_morphing"
    >
      <SvgMorphingDemo />
    </ExampleLayout>,
    {
      title: "SVG Morphing - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/circle_color", () => reply.patch(<ColorSvg fill={color()} />))
example.get("/circle_size", () => reply.patch(<SizeSvg radius={randomInt(15, 59)} />))
example.get("/shape_transform", () => reply.patch(<ShapeSvg variant={randomInt(0, 4)} />))
example.get("/multiple_elements", () => reply.patch(<MultiSvg randomize />))
example.get("/animated_morph", () =>
  reply.stream(
    (async function* () {
      for (const [radius, fill] of [
        [30, "red"],
        [45, "orange"],
        [60, "yellow"],
        [20, "green"]
      ] as const) {
        yield event.patch(
          <AnimatedSvg
            radius={radius}
            fill={fill}
          />
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    })()
  )
)
