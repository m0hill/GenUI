import assert from "node:assert/strict"
import { test } from "node:test"
import type { SubscriptionDelivery } from "genui/protocol"
import { maxSubscriptionFrameBytes, subscriptionDeliveries } from "./subscription-stream.js"

const encoder = new TextEncoder()
const delivery = (sequence: number, message: string): SubscriptionDelivery => ({
  type: "event",
  surfaceId: "surface-1",
  subscriptionId: "subscription-1",
  sequence,
  event: { message },
})

const responseWithChunks = (
  chunks: readonly Uint8Array[],
  contentType = "application/x-ndjson; charset=utf-8",
): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers: { "content-type": contentType } },
  )

const collect = async (response: Response): Promise<readonly SubscriptionDelivery[]> => {
  const deliveries: SubscriptionDelivery[] = []
  for await (const item of subscriptionDeliveries(response)) deliveries.push(item)
  return deliveries
}

void test("subscription NDJSON decoding preserves split UTF-8 and a final unterminated frame", async () => {
  const expected = [delivery(1, "東京"), delivery(2, "ready")]
  const encoded = encoder.encode(`${JSON.stringify(expected[0])}\n${JSON.stringify(expected[1])}`)
  const oneByteChunks = Array.from(encoded, (byte) => Uint8Array.of(byte))

  assert.deepEqual(await collect(responseWithChunks(oneByteChunks)), expected)
})

void test("subscription NDJSON decoding rejects malformed and oversized frames", async () => {
  assert.throws(
    () => subscriptionDeliveries(responseWithChunks([], "application/json")),
    /invalid content type/,
  )

  const invalidEnvelope = { ...delivery(1, "ready"), unexpected: true }
  const malformed: readonly Uint8Array[][] = [
    [encoder.encode("\n")],
    [encoder.encode("{not-json}\n")],
    [encoder.encode(`${JSON.stringify(invalidEnvelope)}\n`)],
    [Uint8Array.of(0xc3, 0x28, 0x0a)],
    [new Uint8Array(maxSubscriptionFrameBytes + 1).fill(0x20)],
  ]

  for (const chunks of malformed) {
    await assert.rejects(collect(responseWithChunks(chunks)), /Subscription transport returned/)
  }
})

void test("stopping subscription NDJSON iteration cancels the response body", async () => {
  let cancellations = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify(delivery(1, "ready"))}\n`))
    },
    cancel() {
      cancellations += 1
    },
  })
  const response = new Response(stream, {
    headers: { "content-type": "application/x-ndjson" },
  })
  const iterator = subscriptionDeliveries(response)[Symbol.asyncIterator]()

  assert.deepEqual(await iterator.next(), { done: false, value: delivery(1, "ready") })
  await iterator.return?.()
  assert.equal(cancellations, 1)
})
