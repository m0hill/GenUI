import assert from "node:assert/strict"
import { test } from "node:test"
import { parseActionCall, parseActionResult, parseSurface } from "./index.js"

const validSurface = {
  id: "surface-1",
  content: "<button>Roll</button>",
  dialect: "code/0",
  grant: {
    surfaceId: "surface-1",
    subject: "session-1",
    expiresAt: 2_000_000_000_000,
    actions: [
      {
        name: "dice.roll",
        description: "Roll a die.",
        effect: "read",
        confidentiality: "normal",
        requiresApproval: false,
        intent: "Roll a die",
        inputSchema: {
          type: "object",
          properties: { sides: { type: "number" } },
          required: ["sides"],
        },
      },
    ],
  },
  meta: { source: "test" },
} as const

void test("parseSurface accepts a JSON round trip and rejects malformed fields", () => {
  const roundTrip: unknown = JSON.parse(JSON.stringify(validSurface))
  assert.deepEqual(parseSurface(roundTrip), validSurface)

  const action = validSurface.grant.actions[0]
  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["record", null],
    ["id", { ...validSurface, id: 1 }],
    ["content", { ...validSurface, content: null }],
    ["dialect", { ...validSurface, dialect: false }],
    ["grant", { ...validSurface, grant: [] }],
    ["grant surfaceId", { ...validSurface, grant: { ...validSurface.grant, surfaceId: 1 } }],
    [
      "grant surface mismatch",
      { ...validSurface, grant: { ...validSurface.grant, surfaceId: "surface-other" } },
    ],
    ["grant actions", { ...validSurface, grant: { ...validSurface.grant, actions: {} } }],
    ["grant subject", { ...validSurface, grant: { ...validSurface.grant, subject: 42 } }],
    ["grant expiresAt", { ...validSurface, grant: { ...validSurface.grant, expiresAt: -1 } }],
    [
      "action name",
      { ...validSurface, grant: { ...validSurface.grant, actions: [{ ...action, name: 1 }] } },
    ],
    [
      "action description",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, description: null }] },
      },
    ],
    [
      "action effect",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, effect: "maybe" }] },
      },
    ],
    [
      "action confidentiality",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, confidentiality: "secret" }] },
      },
    ],
    [
      "action approval",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, requiresApproval: "yes" }] },
      },
    ],
    [
      "action intent",
      { ...validSurface, grant: { ...validSurface.grant, actions: [{ ...action, intent: 1 }] } },
    ],
    [
      "action schema",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, inputSchema: [] }] },
      },
    ],
    ["meta", { ...validSurface, meta: [] }],
  ]

  for (const [field, value] of malformed) {
    assert.equal(parseSurface(value), undefined, field)
  }
})

void test("parseActionCall accepts a JSON round trip and rejects malformed fields", () => {
  const validCall = {
    surfaceId: "surface-1",
    callId: "call-1",
    action: "dice.roll",
    input: { sides: 6 },
  }
  const roundTrip: unknown = JSON.parse(JSON.stringify(validCall))
  assert.deepEqual(parseActionCall(roundTrip), validCall)

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["record", []],
    ["surfaceId", { ...validCall, surfaceId: 1 }],
    ["callId", { ...validCall, callId: null }],
    ["action type", { ...validCall, action: false }],
    ["action name", { ...validCall, action: "invalid" }],
    [
      "input",
      { surfaceId: validCall.surfaceId, callId: validCall.callId, action: validCall.action },
    ],
  ]

  for (const [field, value] of malformed) {
    assert.equal(parseActionCall(value), undefined, field)
  }
})

void test("parseActionResult accepts JSON round trips and rejects malformed fields", () => {
  const success = { ok: true, value: { total: 6 } } as const
  const failure = {
    ok: false,
    error: { code: "approval_denied", message: "Action was denied." },
  } as const
  const rateLimited = {
    ok: false,
    error: { code: "rate_limited", message: "Surface has too many in-flight calls." },
  } as const
  const approvalRequired = {
    ok: false,
    error: {
      code: "approval_required",
      message: "Change order ord-1001 to shipped",
    },
  } as const
  const successRoundTrip: unknown = JSON.parse(JSON.stringify(success))
  const failureRoundTrip: unknown = JSON.parse(JSON.stringify(failure))
  const rateLimitedRoundTrip: unknown = JSON.parse(JSON.stringify(rateLimited))
  const approvalRequiredRoundTrip: unknown = JSON.parse(JSON.stringify(approvalRequired))
  assert.deepEqual(parseActionResult(successRoundTrip), success)
  assert.deepEqual(parseActionResult(failureRoundTrip), failure)
  assert.deepEqual(parseActionResult(rateLimitedRoundTrip), rateLimited)
  assert.deepEqual(parseActionResult(approvalRequiredRoundTrip), approvalRequired)

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["record", null],
    ["ok", { ok: "yes", value: 6 }],
    ["success value", { ok: true }],
    ["failure error", { ok: false, error: "denied" }],
    ["failure code type", { ok: false, error: { code: 1, message: "Denied." } }],
    ["failure code value", { ok: false, error: { code: "nope", message: "Denied." } }],
    [
      "failure message",
      { ok: false, error: { code: "approval_denied", message: { detail: "Denied." } } },
    ],
  ]

  for (const [field, value] of malformed) {
    assert.equal(parseActionResult(value), undefined, field)
  }
})
