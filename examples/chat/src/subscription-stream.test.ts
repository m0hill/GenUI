import assert from "node:assert/strict"
import test from "node:test"
import type { SubscriptionDelivery } from "genui/protocol"
import { maxSubscriptionFrameBytes, subscriptionDeliveries } from "./subscription-stream.js"

const encoder = new TextEncoder()
const delivery = (sequence: number, timestamp: string): SubscriptionDelivery => ({
  type: "event",
  surfaceId: "surface-1",
  subscriptionId: "subscription-1",
  sequence,
  event: { timestamp },
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

void test("subscription NDJSON decoding preserves split frames", async () => {
  const expected = [delivery(1, "2026-01-01T00:00:00.000Z"), delivery(2, "東京")]
  const encoded = encoder.encode(`${JSON.stringify(expected[0])}\n${JSON.stringify(expected[1])}`)
  const oneByteChunks = Array.from(encoded, (byte) => Uint8Array.of(byte))

  assert.deepEqual(await collect(responseWithChunks(oneByteChunks)), expected)
})

void test("subscription NDJSON decoding rejects malformed and oversized frames", async () => {
  assert.throws(
    () => subscriptionDeliveries(responseWithChunks([], "application/json")),
    /invalid content type/,
  )

  const malformed: readonly Uint8Array[][] = [
    [encoder.encode("\n")],
    [encoder.encode("{not-json}\n")],
    [Uint8Array.of(0xc3, 0x28, 0x0a)],
    [new Uint8Array(maxSubscriptionFrameBytes + 1).fill(0x20)],
  ]
  for (const chunks of malformed) {
    await assert.rejects(collect(responseWithChunks(chunks)), /Subscription transport returned/)
  }
})
