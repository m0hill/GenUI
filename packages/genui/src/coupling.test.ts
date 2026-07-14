import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { test } from "node:test"

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)))
      continue
    }
    if (
      entry.isFile() &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test-support.ts")
    )
      files.push(path)
  }

  return files
}

void test("protocol source stays dependency-free", async () => {
  const files = await sourceFiles("src/protocol")

  for (const file of files) {
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["']/, file)
    assert.doesNotMatch(source, /^\s*import\s+["']/m, file)
  }
})

void test("runtime source stays decoupled from app, agent, and transport packages", async () => {
  const files = await sourceFiles("src")

  for (const file of files) {
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["'](?:node:|hono|zod|datastar-kit)/, file)
    assert.doesNotMatch(source, /\bchat\b/i, file)
  }
})

void test("core source stays independent of checker and compiler packages", async () => {
  const files = await sourceFiles("src")

  for (const file of files) {
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["'](?:@genui\/check|parse5|typescript(?:\/|["']))/, file)
  }
})

void test("non-DOM source stays decoupled from the browser host", async () => {
  const files = await sourceFiles("src")
  const domPrefix = `${join("src", "dom")}${sep}`

  for (const file of files) {
    if (file.startsWith(domPrefix)) continue
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["'][^"']*\/dom\//, file)
  }
})

void test("package root exposes the Standard Schema contract without schema internals", async () => {
  const source = await readFile("src/index.ts", "utf8")

  assert.doesNotMatch(source, /\bprotocol\b/)
  assert.match(
    source,
    /export type \{ StandardJSONSchemaV1, StandardSchemaV1 \} from "\.\/schema\.js"/,
  )
  assert.doesNotMatch(source, /\bSchemaParseResult\b/)
  assert.doesNotMatch(source, /\bparseWithSchema\b/)
})
