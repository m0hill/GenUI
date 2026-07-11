import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "./schema.js"

export type Database = DrizzleD1Database<typeof schema>

export const database = (binding: D1Database | D1DatabaseSession): Database =>
  drizzle(binding, { schema })
