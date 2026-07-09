import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
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
  const files = await sourceFiles("src")

  for (const file of files) {
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["']/, file)
    assert.doesNotMatch(source, /^\s*import\s+["']/m, file)
  }
})
