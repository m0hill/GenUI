import { describe, expect, it } from "vitest"
import { z } from "zod"
import { signal } from "../src/ds/index.js"
import * as read from "../src/read.js"
import * as reply from "../src/reply.js"

const CounterSignals = z.object({
  count: z.number()
})

describe("Datastar signal boundary", () => {
  it("keeps typed signal refs explicit instead of schema-derived contracts", () => {
    const count = signal<number, "count">("count")

    expect(count.toDatastarExpression()).toBe("$count")
  })

  it("leaves app validation to the caller after decoding Datastar signals", async () => {
    const request = new Request("http://localhost/increment", {
      method: "POST",
      body: JSON.stringify({ count: 1 })
    })

    const parsed = CounterSignals.parse(await read.signals(request))
    const exact: { readonly count: number } = parsed

    expect(exact).toEqual({ count: 1 })
  })

  it("lets validator-specific errors stay validator-specific", async () => {
    const request = new Request("http://localhost/increment", {
      method: "POST",
      body: JSON.stringify({ count: "bad" })
    })

    const signals = await read.signals(request)

    expect(() => CounterSignals.parse(signals)).toThrow(z.ZodError)
  })

  it("patches validated signal output with normal response helpers", async () => {
    const response = reply.signals({ count: 2 })

    expect(await response.text()).toBe(
      'event: datastar-patch-signals\ndata: signals {"count":2}\n\n'
    )
  })
})
