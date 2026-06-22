import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gunzip } from "node:zlib"
import { Hono } from "hono"
import { event, reply, state, get, js, mod } from "datastar-kit"
import { ExampleLayout, pageHead } from "../layout.js"

const gunzipAsync = promisify(gunzip)
const framesPath = fileURLToPath(new URL("../../public/bad-apple-frames.txt.gz", import.meta.url))
const framesPerSecond = 30
const frameDelayMs = 1000 / framesPerSecond
const frames = readFile(framesPath)
  .then(gunzipAsync)
  .then((buffer) => buffer.toString("utf8").split("\f"))

const playbackState = state({
  _percentage: 0,
  _contents: "bad apple frames go here"
})

const BadApplePanel = () => (
  <div class="bad-apple">
    <label
      data-signals={mod(playbackState.defaults, { ifMissing: true })}
      data-init={get("/examples/bad_apple/updates")}
    >
      <span
        data-text={js`${"Percentage: "} + ${playbackState.refs._percentage}.toFixed(2) + ${"%"}`}
      ></span>
      <input
        type="range"
        min="0"
        max="100"
        step="0.01"
        disabled
        style="cursor: default"
        data-attr:value={playbackState.refs._percentage}
      />
    </label>
    <pre
      style="line-height: 100%"
      aria-live="polite"
      data-text={playbackState.refs._contents}
    ></pre>
  </div>
)

export const example = new Hono()

example.get("/", () =>
  reply.page(
    <ExampleLayout
      title="Bad Apple"
      slug="bad_apple"
      summary="Streams signal patches that update a progress control and ASCII frame output."
      source="https://data-star.dev/examples/bad_apple"
    >
      <BadApplePanel />
    </ExampleLayout>,
    {
      title: "Bad Apple - Datastar Kit",
      head: pageHead()
    }
  )
)

example.get("/updates", async (c) => {
  const loadedFrames = await frames

  async function* stream() {
    for (let index = 0; index < loadedFrames.length && !c.req.raw.signal.aborted; index += 1) {
      yield event.signals({
        _percentage: (index / loadedFrames.length) * 100,
        _contents: loadedFrames[index] ?? ""
      })
      await new Promise((resolve) => setTimeout(resolve, frameDelayMs))
    }
  }

  return reply.stream(stream(), { heartbeat: { intervalMs: 15_000, comment: "bad-apple" } })
})
