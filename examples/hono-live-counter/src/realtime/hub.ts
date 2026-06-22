interface Subscriber {
  queued: number
  closed: boolean
  resolve?: (() => void) | undefined
}

export class InvalidationBus {
  readonly #subscribers = new Set<Subscriber>()
  #closed = false

  publish() {
    if (this.#closed) return

    for (const subscriber of this.#subscribers) {
      if (subscriber.closed) continue

      if (subscriber.resolve !== undefined) {
        const resolve = subscriber.resolve
        subscriber.resolve = undefined
        resolve()
      } else {
        subscriber.queued += 1
      }
    }
  }

  close() {
    if (this.#closed) return
    this.#closed = true

    for (const subscriber of this.#subscribers) {
      subscriber.closed = true
      subscriber.resolve?.()
    }
  }

  subscribe(signal?: AbortSignal): AsyncIterable<void> {
    if (this.#closed || signal?.aborted === true) {
      return {
        async *[Symbol.asyncIterator]() {}
      }
    }

    const subscriber: Subscriber = { queued: 0, closed: false }
    const subscribers = this.#subscribers
    const closeSubscriber = () => {
      subscriber.closed = true
      const resolve = subscriber.resolve
      subscriber.resolve = undefined
      resolve?.()
    }

    signal?.addEventListener("abort", closeSubscriber, { once: true })
    subscribers.add(subscriber)

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (!subscriber.closed) {
            if (subscriber.queued > 0) {
              subscriber.queued -= 1
              yield
              continue
            }

            // eslint-disable-next-line no-await-in-loop -- Async iterators wait for the next publish before yielding again.
            await new Promise<void>((resolve) => {
              subscriber.resolve = resolve
            })
            subscriber.resolve = undefined

            if (!subscriber.closed) yield
          }
        } finally {
          signal?.removeEventListener("abort", closeSubscriber)
          closeSubscriber()
          subscribers.delete(subscriber)
        }
      }
    }
  }
}

export const invalidations = new InvalidationBus()
