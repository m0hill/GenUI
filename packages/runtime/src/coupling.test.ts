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

const topLevelSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test-support.ts"),
    )
    .map((entry) => join(directory, entry.name))
}

const importSpecifiers = (source: string): string[] => {
  const specifiers: string[] = []

  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }

  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }

  return specifiers
}

void test("runtime source stays decoupled from app, agent, and transport packages", async () => {
  const files = await sourceFiles("src")

  for (const file of files) {
    const source = await readFile(file, "utf8")
    assert.doesNotMatch(source, /\bfrom\s+["'](?:node:|hono|zod|datastar-kit)/, file)
    assert.doesNotMatch(source, /\bchat\b/i, file)
  }
})

void test("package root does not re-export internal schema compatibility helpers", async () => {
  const source = await readFile("src/index.ts", "utf8")

  assert.doesNotMatch(source, /\bStandardSchema/)
  assert.doesNotMatch(source, /\bStandardTyped/)
})

void test("runtime core imports only the internal genui/0 surface dialect", async () => {
  const files = await topLevelSourceFiles("src")
  const allowedDialectImport = "./dialect/genui0-surface.js"

  for (const file of files) {
    const source = await readFile(file, "utf8")

    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith("./dialect/")) continue
      assert.equal(specifier, allowedDialectImport, `${file} imports ${specifier}`)
    }
  }
})

void test("dialect source does not import runtime core files", async () => {
  const files = await sourceFiles("src/dialect")

  for (const file of files) {
    const source = await readFile(file, "utf8")

    for (const specifier of importSpecifiers(source)) {
      assert.equal(
        specifier.startsWith("../"),
        false,
        `${file} imports runtime core module ${specifier}`,
      )
    }
  }
})
