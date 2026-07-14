import assert from "node:assert/strict"
import { test } from "node:test"
import { codeEnvironmentInstructions } from "./instructions.js"

// #1 measured 5,981 characters for the legacy representative contract and 2,159 for declarations.
// This ceiling keeps the new stable-plus-declaration total below that legacy contract alone.
const stableInstructionCharacterBudget = 3_500

void test("code environment instructions stay compact and capability-independent", () => {
  const instructions = codeEnvironmentInstructions()

  assert.equal(
    instructions.length <= stableInstructionCharacterBudget,
    true,
    `stable instructions grew to ${instructions.length} characters`,
  )
  assert.doesNotMatch(instructions, /orders\./)
  assert.doesNotMatch(instructions, /web\.search|preferences\.save|time\.tick/)
  assert.doesNotMatch(instructions, /Generated-interface capability contract/)
  assert.doesNotMatch(instructions, /Exact JSON Schema for/)
})

void test("code environment instructions retain security, failure, and lifecycle semantics", () => {
  const instructions = codeEnvironmentInstructions()

  assert.match(instructions, /opaque-origin iframe/)
  assert.match(instructions, /no network, storage, parent DOM access/)
  assert.match(instructions, /not\s+authorization/)
  assert.match(instructions, /trusted host rechecks every action and subscription/)
  assert.match(instructions, /GenuiActionError/)
  assert.match(instructions, /Catch failures/)
  assert.match(instructions, /Events\s+arrive in order/)
  assert.match(instructions, /done` always\s+resolves/)
  assert.match(instructions, /no reconnect or replay/)
  assert.match(instructions, /genui\.snapshot/)
  assert.match(instructions, /genui\.teardown/)
  assert.match(instructions, /host continues after its deadline/)
})

void test("code environment instructions retain portable host integration rules", () => {
  const instructions = codeEnvironmentInstructions()

  assert.match(instructions, /genui\.hostContext/)
  assert.match(instructions, /genui\.onHostContextChange/)
  assert.match(instructions, /locale and time zone explicitly to `Intl`/)
  assert.match(instructions, /responsive CSS/)
  assert.match(instructions, /user-agent sniffing/)
  assert.match(instructions, /typeof genui\.sendMessage === "function"/)
  assert.match(instructions, /sendMessage\(text\).*model\s+follow-up/s)
  assert.match(instructions, /openLink\(url\).*absolute HTTPS URLs/s)
  assert.match(instructions, /updateModelContext.*without an immediate follow-up/s)
  assert.match(instructions, /--color-background-primary/)
  assert.match(instructions, /--border-radius-sm/)
  assert.match(instructions, /light-dark\(\)/)
  assert.match(instructions, /system font stack/)
})

void test("code environment instructions describe a command-only guest API", () => {
  const instructions = codeEnvironmentInstructions()

  assert.match(instructions, /JavaScript, not TypeScript/)
  assert.match(instructions, /never add annotations,\s+interfaces, or `as` casts/)
  assert.match(instructions, /Call only action names declared in that contract/)
  assert.match(instructions, /Subscribe only to names declared in that contract/)
  assert.doesNotMatch(instructions, /genui\.(actions|subscriptions|capabilities)/)
})
