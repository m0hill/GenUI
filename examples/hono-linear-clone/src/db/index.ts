import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema.js"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export const db = drizzle(resolve(rootDir, "data.sqlite"), { schema })
