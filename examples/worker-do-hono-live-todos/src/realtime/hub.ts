import { DurableObject } from "cloudflare:workers"
import { reply } from "datastar-kit"

export interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

interface TodoMutationResult {
  changed: boolean
  todos: Todo[]
}

interface TodoRow extends Record<string, SqlStorageValue> {
  id: string
  title: string
  completed: number
  created_at: number
  updated_at: number
}

type LiveIteratorResult = IteratorResult<string, undefined>

interface LiveSubscriber {
  closed: boolean
  queued: string[]
  resolve?: ((result: LiveIteratorResult) => void) | undefined
}

export class TodoRoom extends DurableObject<CloudflareBindings> {
  readonly #subscribers = new Set<LiveSubscriber>()

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env)

    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  getTodos(): Todo[] {
    return this.#readTodos()
  }

  createTodo(title: string): Todo[] {
    const now = Date.now()

    this.ctx.storage.sql.exec(
      `
        INSERT INTO todos (id, title, completed, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `,
      crypto.randomUUID(),
      title,
      now,
      now
    )

    return this.#readTodos()
  }

  toggleTodo(id: string): TodoMutationResult {
    const result = this.ctx.storage.sql.exec(
      `
        UPDATE todos
        SET completed = CASE completed WHEN 0 THEN 1 ELSE 0 END,
            updated_at = ?
        WHERE id = ?
      `,
      Date.now(),
      id
    )

    return {
      changed: result.rowsWritten > 0,
      todos: this.#readTodos()
    }
  }

  deleteTodo(id: string): TodoMutationResult {
    const result = this.ctx.storage.sql.exec("DELETE FROM todos WHERE id = ?", id)

    return {
      changed: result.rowsWritten > 0,
      todos: this.#readTodos()
    }
  }

  subscribe(initialEvents: string): Response {
    const subscriber: LiveSubscriber = { closed: false, queued: [initialEvents] }

    this.#subscribers.add(subscriber)

    return reply.stream(this.#events(subscriber), {
      heartbeat: { intervalMs: 15_000, comment: "live-room" }
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

  #readTodos(): Todo[] {
    const rows = this.ctx.storage.sql
      .exec<TodoRow>(`
        SELECT id, title, completed, created_at, updated_at
        FROM todos
        ORDER BY created_at ASC, id ASC
      `)
      .toArray()

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      completed: row.completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }
}
