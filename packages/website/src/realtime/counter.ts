import { DurableObject } from "cloudflare:workers"
import { reply } from "datastar-kit"

type LiveIteratorResult = IteratorResult<string, undefined>

interface LiveSubscriber {
  closed: boolean
  queued: string[]
  resolve?: ((result: LiveIteratorResult) => void) | undefined
}

interface CounterRow extends Record<string, SqlStorageValue> {
  count: number
}

export class VisitorCounter extends DurableObject<CloudflareBindings> {
  readonly #subscribers = new Set<LiveSubscriber>()

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env)

    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counter (
        id INTEGER PRIMARY KEY,
        count INTEGER NOT NULL
      )
    `)
    ctx.storage.sql.exec("INSERT OR IGNORE INTO counter (id, count) VALUES (1, 0)")
  }

  getCount(): number {
    return this.#readCount()
  }

  bump(): number {
    this.ctx.storage.sql.exec("UPDATE counter SET count = count + 1 WHERE id = 1")
    return this.#readCount()
  }

  subscribe(initialEvents: string): Response {
    const subscriber: LiveSubscriber = { closed: false, queued: [initialEvents] }

    this.#subscribers.add(subscriber)

    return reply.stream(this.#events(subscriber), {
      heartbeat: { intervalMs: 15_000, comment: "live-counter" }
    })
  }

  publish(events: string): number {
    for (const subscriber of this.#subscribers) {
      this.#send(subscriber, events)
    }

    return this.#subscribers.size
  }

  #events(subscriber: LiveSubscriber): AsyncIterableIterator<string> {
    return {
      [Symbol.asyncIterator]() {
        return this
      },
      next: () => this.#next(subscriber),
      return: () => {
        this.#close(subscriber)
        return Promise.resolve({ done: true, value: undefined })
      }
    }
  }

  #next(subscriber: LiveSubscriber): Promise<LiveIteratorResult> {
    if (subscriber.closed) return Promise.resolve({ done: true, value: undefined })

    const value = subscriber.queued.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })

    return new Promise<LiveIteratorResult>((resolve) => {
      subscriber.resolve = resolve
    })
  }

  #send(subscriber: LiveSubscriber, chunk: string) {
    if (subscriber.closed) return

    subscriber.queued.push(chunk)
    const resolve = subscriber.resolve
    if (resolve === undefined) return

    subscriber.resolve = undefined
    resolve(this.#nextQueued(subscriber))
  }

  #nextQueued(subscriber: LiveSubscriber): LiveIteratorResult {
    const value = subscriber.queued.shift()
    return value === undefined || subscriber.closed
      ? { done: true, value: undefined }
      : { done: false, value }
  }

  #close(subscriber: LiveSubscriber) {
    if (subscriber.closed) return
    subscriber.closed = true
    const resolve = subscriber.resolve
    subscriber.resolve = undefined
    resolve?.({ done: true, value: undefined })
    this.#subscribers.delete(subscriber)
  }

  #readCount(): number {
    const row = this.ctx.storage.sql
      .exec<CounterRow>("SELECT count FROM counter WHERE id = 1")
      .one()
    return row.count
  }
}
