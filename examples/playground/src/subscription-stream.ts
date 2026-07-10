import {
  parseSubscriptionDelivery,
  subscriptionEventByteLimit,
  type SubscriptionDelivery,
} from "genui/protocol"

// Allow bounded transport-envelope overhead around the kernel's 64 KiB event limit.
export const maxSubscriptionFrameBytes = subscriptionEventByteLimit + 4 * 1_024

type SubscriptionFrameBytes = Uint8Array<ArrayBufferLike>

const appendFrameBytes = (
  buffered: SubscriptionFrameBytes,
  bytes: SubscriptionFrameBytes,
): SubscriptionFrameBytes => {
  if (buffered.byteLength + bytes.byteLength > maxSubscriptionFrameBytes) {
    throw new Error("Subscription transport returned an oversized frame.")
  }
  if (bytes.byteLength === 0) return buffered

  const combined = new Uint8Array(buffered.byteLength + bytes.byteLength)
  combined.set(buffered)
  combined.set(bytes, buffered.byteLength)
  return combined
}

const parseFrame = (bytes: SubscriptionFrameBytes): SubscriptionDelivery => {
  if (bytes.byteLength === 0) {
    throw new Error("Subscription transport returned an empty frame.")
  }

  let value: unknown
  try {
    const encoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    value = JSON.parse(encoded) as unknown
  } catch {
    throw new Error("Subscription transport returned invalid NDJSON.")
  }
  const delivery = parseSubscriptionDelivery(value)
  if (delivery === undefined) {
    throw new Error("Subscription transport returned an invalid delivery envelope.")
  }
  return delivery
}

const decodeSubscriptionBody = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncIterable<SubscriptionDelivery> {
  const reader = body.getReader()
  let buffered: SubscriptionFrameBytes = new Uint8Array()
  let completed = false

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.value !== undefined) {
        let frameStart = 0
        for (let index = 0; index < chunk.value.byteLength; index += 1) {
          if (chunk.value[index] !== 0x0a) continue
          buffered = appendFrameBytes(buffered, chunk.value.subarray(frameStart, index))
          yield parseFrame(buffered)
          buffered = new Uint8Array()
          frameStart = index + 1
        }
        buffered = appendFrameBytes(buffered, chunk.value.subarray(frameStart))
      }
      if (!chunk.done) continue

      completed = true
      if (buffered.byteLength > 0) yield parseFrame(buffered)
      return
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export const subscriptionDeliveries = (response: Response): AsyncIterable<SubscriptionDelivery> => {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/x-ndjson") {
    throw new Error("Subscription transport returned an invalid content type.")
  }
  if (response.body === null) throw new Error("Subscription response has no body.")
  return decodeSubscriptionBody(response.body)
}
