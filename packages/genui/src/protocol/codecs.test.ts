import assert from "node:assert/strict"
import { test } from "node:test"
import {
  maxSurfaceContentBytes,
  parseActionCall,
  parseActionResult,
  parseSubscriptionDelivery,
  parseSubscriptionError,
  parseSubscriptionRequest,
  parseSurface,
  subscriptionEventByteLimit,
} from "./index.js"

const exactSurfaceContent = `${"界".repeat(Math.floor(maxSurfaceContentBytes / 3))}x`
const oversizedSurfaceContent = `${exactSurfaceContent}界`

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
        outputSchema: {
          type: "object",
          properties: { total: { type: "number" } },
          required: ["total"],
        },
      },
    ],
    subscriptions: [
      {
        name: "orders.changes",
        description: "Receive order changes.",
        confidentiality: "normal",
        maxEventBytes: subscriptionEventByteLimit,
        inputSchema: { type: "object" },
        eventSchema: { type: "object" },
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
    [
      "grant subscriptions",
      { ...validSurface, grant: { ...validSurface.grant, subscriptions: {} } },
    ],
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
      "action input schema",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, inputSchema: [] }] },
      },
    ],
    [
      "action output schema",
      {
        ...validSurface,
        grant: { ...validSurface.grant, actions: [{ ...action, outputSchema: [] }] },
      },
    ],
    ["meta", { ...validSurface, meta: [] }],
  ]

  for (const [field, value] of malformed) {
    assert.equal(parseSurface(value), undefined, field)
  }
})

void test("PREFLIGHT-BOUNDS-006 parses only Surface content within the UTF-8 bound", () => {
  assert.equal(exactSurfaceContent.length < maxSurfaceContentBytes, true)
  assert.equal(new TextEncoder().encode(exactSurfaceContent).byteLength, maxSurfaceContentBytes)
  assert.equal(
    new TextEncoder().encode(oversizedSurfaceContent).byteLength > maxSurfaceContentBytes,
    true,
  )
  assert.notEqual(parseSurface({ ...validSurface, content: exactSurfaceContent }), undefined)
  assert.equal(parseSurface({ ...validSurface, content: oversizedSurfaceContent }), undefined)
})

void test("subscription codecs copy exact requests and delivery envelopes", () => {
  const request = {
    surfaceId: "surface-1",
    subscriptionId: "subscription-1",
    subscription: "orders.changes",
    input: { status: "processing" },
  }
  const parsedRequest = parseSubscriptionRequest(request)
  assert.deepEqual(parsedRequest, request)
  request.input.status = "mutated"
  assert.deepEqual(parsedRequest?.input, { status: "processing" })
  request.input.status = "processing"
  assert.equal(parseSubscriptionRequest({ ...request, extra: true }), undefined)
  assert.equal(parseSubscriptionRequest({ ...request, subscription: "invalid" }), undefined)
  assert.equal(
    parseSubscriptionRequest({
      surfaceId: request.surfaceId,
      subscriptionId: request.subscriptionId,
      subscription: request.subscription,
    }),
    undefined,
  )

  const sourceEvent = { order: { id: "ord-1" } }
  const delivery = parseSubscriptionDelivery({
    type: "event",
    surfaceId: request.surfaceId,
    subscriptionId: request.subscriptionId,
    sequence: 1,
    event: sourceEvent,
  })
  assert.deepEqual(delivery, {
    type: "event",
    surfaceId: request.surfaceId,
    subscriptionId: request.subscriptionId,
    sequence: 1,
    event: sourceEvent,
  })
  sourceEvent.order.id = "mutated"
  assert.deepEqual(delivery?.type === "event" ? delivery.event : undefined, {
    order: { id: "ord-1" },
  })

  const error = { code: "revoked", message: "Subscription authority was revoked." } as const
  assert.deepEqual(parseSubscriptionError(error), error)
  assert.equal(parseSubscriptionError({ ...error, cause: "secret" }), undefined)
  assert.deepEqual(
    parseSubscriptionDelivery({
      type: "error",
      surfaceId: request.surfaceId,
      subscriptionId: request.subscriptionId,
      error,
    }),
    {
      type: "error",
      surfaceId: request.surfaceId,
      subscriptionId: request.subscriptionId,
      error,
    },
  )

  const malformed = [
    { type: "event", surfaceId: "surface-1", subscriptionId: "sub-1", sequence: 0, event: {} },
    { type: "event", surfaceId: "surface-1", subscriptionId: "sub-1", sequence: 1.5, event: {} },
    { type: "event", surfaceId: "surface-1", subscriptionId: "sub-1", sequence: 1 },
    {
      type: "event",
      surfaceId: "surface-1",
      subscriptionId: "sub-1",
      sequence: 1,
      event: undefined,
    },
    {
      type: "event",
      surfaceId: "surface-1",
      subscriptionId: "sub-1",
      sequence: 1,
      event: {},
      extra: true,
    },
    {
      type: "error",
      surfaceId: "surface-1",
      subscriptionId: "sub-1",
      error: { code: "unknown", message: "no" },
    },
  ]
  for (const value of malformed) assert.equal(parseSubscriptionDelivery(value), undefined)
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
