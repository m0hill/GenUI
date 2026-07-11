import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const drizzleDir = path.join(root, "drizzle")
const migrationsDir = path.join(root, "migrations")

mkdirSync(migrationsDir, { recursive: true })

for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    rmSync(path.join(migrationsDir, entry.name))
  }
}

if (!existsSync(drizzleDir)) {
  console.log("No Drizzle migrations found.")
  process.exit(0)
}

const migrationNames = readdirSync(drizzleDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted()

for (const [index, migrationName] of migrationNames.entries()) {
  const source = path.join(drizzleDir, migrationName, "migration.sql")
  if (!existsSync(source)) {
    continue
  }

  const slug = migrationName.replace(/^\d+_/, "")
  const wranglerName = `${index.toString().padStart(4, "0")}_${slug}.sql`
  const target = path.join(migrationsDir, wranglerName)
  copyFileSync(source, target)
  console.log(`Synced ${path.relative(root, target)}`)
}
