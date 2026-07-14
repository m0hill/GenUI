import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { genuiGuestDeclarations, genuiSubscriptionHandleDeclaration } from "./guest-contract.js"

void test("guest declarations share the canonical subscription handle with documentation", async () => {
  assert.equal(genuiGuestDeclarations.includes(genuiSubscriptionHandleDeclaration), true)
  assert.doesNotMatch(genuiGuestDeclarations, /interface ParentNode|interface Document/)

  const documentation = await readFile(
    new URL("../../../../docs/code0.md", import.meta.url),
    "utf8",
  )
  assert.equal(documentation.includes(genuiSubscriptionHandleDeclaration), true)
})
