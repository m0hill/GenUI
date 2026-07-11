import { EventEmitter, on } from "node:events"
import { createClient } from "redis"

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
const channel =
  process.env.REDIS_INVALIDATION_CHANNEL ?? "datastar-kit:hono-live-counter:invalidations"

const events = new EventEmitter()
events.setMaxListeners(0)

const publisher = createClient({ url: redisUrl })
const subscriber = createClient({ url: redisUrl })

let publisherReady: Promise<void> | undefined
let subscriberReady: Promise<void> | undefined

publisher.on("error", (error) => {
  console.error("Redis publisher error", error)
})

subscriber.on("error", (error) => {
  console.error("Redis subscriber error", error)
})

async function connectPublisher() {
  publisherReady ??= publisher.connect().then(() => undefined)
  await publisherReady
}

async function connectSubscriber() {
  subscriberReady ??= subscriber
    .connect()
    .then(() => subscriber.subscribe(channel, () => events.emit("invalidate")))
    .then(() => undefined)

  await subscriberReady
}

async function* empty() {}

export const invalidations = {
  async publish() {
    await connectPublisher()
    await publisher.publish(channel, "invalidate")
  },

  subscribe(signal?: AbortSignal): AsyncIterable<void> {
    if (signal?.aborted === true) return empty()

    const ready = connectSubscriber()
    const updates = on(events, "invalidate", { signal })

    async function* stream() {
      try {
        await ready

        for await (const _ of updates) {
          yield
        }
      } catch (error) {
        if (signal?.aborted !== true) throw error
      } finally {
        await updates.return?.()
      }
    }

    return stream()
  }
}
