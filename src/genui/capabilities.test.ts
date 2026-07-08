import assert from "node:assert/strict"
import { test } from "node:test"
import { z } from "zod"
import { createCapabilityRegistry, defineCapability } from "./capabilities.js"

void test("capability registry executes approved granted capabilities", async () => {
  const registry = createCapabilityRegistry([
    defineCapability({
      name: "demo.echo",
      description: "Echo text for tests.",
      effect: "read",
      inputSchema: z.object({ text: z.string() }),
      execute: (_ctx, input) => ({ text: input.text }),
    }),
  ])

  const manifest = registry.projectManifest(["demo.echo"])
  assert.deepEqual(
    manifest.capabilities.map((capability) => capability.name),
    ["demo.echo"],
  )

  const result = await registry.execute({
    capability: "demo.echo",
    input: { text: "hello" },
    approved: false,
    signal: AbortSignal.timeout(1_000),
  })

  assert.deepEqual(result, { ok: true, result: { text: "hello" } })
})

void test("capability registry denies unknown, blocked, invalid, and unapproved calls", async () => {
  const registry = createCapabilityRegistry([
    defineCapability({
      name: "demo.secret",
      description: "Blocked test capability.",
      effect: "dangerous",
      policy: "block",
      inputSchema: z.object({ value: z.string() }),
      execute: (_ctx, input) => input,
    }),
    defineCapability({
      name: "demo.write",
      description: "Approval-gated test capability.",
      effect: "external_write",
      requiresApproval: true,
      inputSchema: z.object({ value: z.string().min(1) }),
      execute: (_ctx, input) => input,
    }),
  ])

  assert.equal(
    (await registry.execute({ capability: "missing", input: {}, approved: true })).ok,
    false,
  )
  assert.equal(
    (await registry.execute({ capability: "demo.secret", input: { value: "x" }, approved: true }))
      .ok,
    false,
  )
  assert.equal(
    (await registry.execute({ capability: "demo.write", input: {}, approved: true })).ok,
    false,
  )
  assert.equal(
    (
      await registry.execute({
        capability: "demo.write",
        input: { value: "x" },
        approved: false,
      })
    ).ok,
    false,
  )

  assert.deepEqual(
    await registry.execute({
      capability: "demo.write",
      input: { value: "x" },
      approved: true,
    }),
    { ok: true, result: { value: "x" } },
  )
})
