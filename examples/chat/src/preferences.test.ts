import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { JsonPreferenceStore } from "./preferences.js"

void test("JSON preference store persists and replaces the saved preference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-preferences-"))
  const filePath = join(directory, "preferences.json")

  try {
    const store = new JsonPreferenceStore(filePath)
    assert.equal(await store.get(), undefined)

    await store.save("Mountain cabin")
    await store.save("City weekend")

    assert.equal((await new JsonPreferenceStore(filePath).get())?.preferredTrip, "City weekend")
    assert.deepEqual(Object.keys(JSON.parse(await readFile(filePath, "utf8"))).sort(), [
      "preferredTrip",
      "updatedAt",
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSON preference store rejects invalid data instead of migrating it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-preferences-"))
  const filePath = join(directory, "preferences.json")

  try {
    await writeFile(filePath, JSON.stringify({ preference: "legacy" }), "utf8")
    await assert.rejects(new JsonPreferenceStore(filePath).get(), /Preference store is invalid/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
