import { afterEach, describe, expect, it, vi } from "vitest"
import { h, unsafeHtml } from "../src/html.js"
import * as reply from "../src/reply.js"

describe("reply SSE responses", () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it("serves Datastar SSE streams from a single event string", async () => {
    const response = reply.stream("event: ready\n\n", {}, { headers: { "x-sse": "yes" } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(response.headers.get("x-sse")).toBe("yes")
    expect(await response.text()).toBe("event: ready\n\n")
  })

  it("serves Datastar signal patch responses", async () => {
    const response = reply.signals({ count: 1 }, {}, { headers: { "x-signals": "yes" } })

    expect(response.headers.get("x-signals")).toBe("yes")
    expect(await response.text()).toBe(
      'event: datastar-patch-signals\ndata: signals {"count":1}\n\n'
    )
  })

  it("renders HTML nodes in element patches", async () => {
    const response = reply.patch(
      h("span", {}, "Ada & Grace"),
      { selector: "#name" },
      { headers: { "x-patch": "yes" } }
    )

    expect(response.headers.get("x-patch")).toBe("yes")
    expect(await response.text()).toBe(
      "event: datastar-patch-elements\ndata: selector #name\ndata: elements <span>Ada &amp; Grace</span>\n\n"
    )
  })

  it("escapes string patches unless unsafe HTML is explicit", async () => {
    const text = reply.patch("<strong>Saved</strong>")
    const html = reply.patch(unsafeHtml("<strong>Saved</strong>"))

    expect(await text.text()).toBe(
      "event: datastar-patch-elements\ndata: elements &lt;strong&gt;Saved&lt;/strong&gt;\n\n"
    )
    expect(await html.text()).toBe(
      "event: datastar-patch-elements\ndata: elements <strong>Saved</strong>\n\n"
    )
  })

  it("streams async iterable SSE responses", async () => {
    async function* events() {
      yield "event: first\n\n"
      yield "event: second\n\n"
    }

    const response = reply.stream(events())

    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(await response.text()).toBe("event: first\n\nevent: second\n\n")
  })

  it("streams string and byte chunks", async () => {
    const response = reply.stream([
      "event: first\n\n",
      new TextEncoder().encode("event: second\n\n")
    ])

    expect(await response.text()).toBe("event: first\n\nevent: second\n\n")
  })

  it("streams Web Stream responses with headers", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("event: meta\n\n")
        controller.close()
      }
    })
    const response = reply.stream(source, {}, { headers: { "x-stream": "web" } })

    expect(response.status).toBe(200)
    expect(response.headers.get("x-stream")).toBe("web")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(await response.text()).toBe("event: meta\n\n")
  })

  it("starts heartbeat timers on first pull and clears them on cancel", async () => {
    vi.useFakeTimers()
    async function* events() {
      yield "event: ready\n\n"
      await new Promise<never>(() => {})
    }

    const reader = reply
      .stream(events(), {
        heartbeat: { initialDelayMs: 10, intervalMs: 20, comment: "tick" }
      })
      .body!.getReader()

    expect(vi.getTimerCount()).toBe(0)
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("event: ready\n\n")
    expect(vi.getTimerCount()).toBe(1)

    const next = reader.read()
    await vi.advanceTimersByTimeAsync(10)
    const heartbeat = await next
    expect(new TextDecoder().decode(heartbeat.value)).toBe(": tick\n\n")
    expect(vi.getTimerCount()).toBe(1)

    await reader.cancel()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears heartbeat timers when the event source closes", async () => {
    vi.useFakeTimers()
    const reader = reply
      .stream(["event: ready\n\n"], {
        heartbeat: { intervalMs: 100 }
      })
      .body!.getReader()

    expect(await reader.read()).toMatchObject({ done: false })
    expect(vi.getTimerCount()).toBe(1)
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })
})
