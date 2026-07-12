import {
  parseSubscriptionDelivery,
  subscriptionEventByteLimit,
  type SubscriptionDelivery,
} from "genui/protocol"

export const maxSubscriptionFrameBytes = subscriptionEventByteLimit + 4 * 1_024

const encoder = new TextEncoder()

const parseFrame = (frame: string): SubscriptionDelivery => {
  if (frame.length === 0) {
    throw new Error("Subscription transport returned an empty frame.")
  }
  if (encoder.encode(frame).byteLength > maxSubscriptionFrameBytes) {
    throw new Error("Subscription transport returned an oversized frame.")
  }

  let value: unknown
  try {
    value = JSON.parse(frame) as unknown
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
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffered = ""
  let completed = false

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.value !== undefined) buffered += decoder.decode(chunk.value, { stream: true })
      if (chunk.done) buffered += decoder.decode()
      let newline = buffered.indexOf("\n")
      while (newline !== -1) {
        yield parseFrame(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf("\n")
      }
      if (encoder.encode(buffered).byteLength > maxSubscriptionFrameBytes) {
        throw new Error("Subscription transport returned an oversized frame.")
      }
      if (!chunk.done) continue

      completed = true
      if (buffered.length > 0) yield parseFrame(buffered)
      return
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Subscription transport returned")) {
      throw error
    }
    throw new Error("Subscription transport returned invalid NDJSON.")
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
