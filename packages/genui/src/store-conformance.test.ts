import { test } from "node:test"
import { memoryStore } from "./surface-runtime.js"
import { assertSurfaceStoreConformance } from "./testing/index.js"

void test("memory store satisfies the SurfaceStore contract", async () => {
  const store = memoryStore()
  await assertSurfaceStoreConformance(() => store)
})
