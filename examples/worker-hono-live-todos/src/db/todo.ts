import { asc, eq, sql } from "drizzle-orm"
import { todos, type Todo } from "./schema.js"
import type { Database } from "./index.js"

export async function readTodos(db: Database): Promise<Todo[]> {
  const rows = await db.select().from(todos).orderBy(asc(todos.createdAt), asc(todos.id)).all()

  return rows
}

export async function createTodo(db: Database, title: string) {
  const now = Date.now()

  await db
    .insert(todos)
    .values({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: now,
      updatedAt: now
    })
    .run()
}

export async function toggleTodo(db: Database, id: string): Promise<boolean> {
  const now = Date.now()
  const result = await db
    .update(todos)
    .set({
      completed: sql`CASE ${todos.completed} WHEN 0 THEN 1 ELSE 0 END`,
      updatedAt: now
    })
    .where(eq(todos.id, id))
    .run()

  return result.meta.changes > 0
}

export async function deleteTodo(db: Database, id: string): Promise<boolean> {
  const result = await db.delete(todos).where(eq(todos.id, id)).run()

  return result.meta.changes > 0
}
