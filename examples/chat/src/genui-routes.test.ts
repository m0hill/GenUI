import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Hono } from "hono"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { CallAuditEntry, GenuiErrorEvent } from "genui"
import type { ActionCall, SubscriptionRequest } from "genui/protocol"
import { createChatGenui, generatedUi } from "./ai/genui.js"
import { streamChatWithProvider } from "./ai/index.js"
import { createAuthenticatedSessions, type AuthenticatedSession } from "./authenticated-session.js"
import { createPendingApprovals, parseExecuteEnvelope, pendingApprovals } from "./approval.js"
import { createGenuiRoutes } from "./genui-routes.js"
import { JsonPreferenceStore } from "./preferences.js"
import { JsonlChatSession } from "./session.js"

const authenticatedHeaders = (
  session: AuthenticatedSession,
  csrfToken = session.csrfToken,
): Readonly<Record<string, string>> => ({
  "content-type": "application/json",
  cookie: `chat_session=${session.credential}`,
  "x-chat-csrf": csrfToken,
})

const postJson = (
  app: Hono,
  path: string,
  body: unknown,
  session?: AuthenticatedSession,
  csrfToken?: string,
): Promise<Response> =>
  Promise.resolve(
    app.request(path, {
      method: "POST",
      headers:
        session === undefined
          ? { "content-type": "application/json" }
          : authenticatedHeaders(session, csrfToken),
      body: JSON.stringify(body),
    }),
  )

const createRequestBarrier = (participants: number) => {
  let enabled = false
  let arrivals = 0
  let release: (() => void) | undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  return {
    enable: () => {
      enabled = true
    },
    wait: async () => {
      if (!enabled) return
      arrivals += 1
      if (arrivals === participants) release?.()
      await released
    },
  }
}

class CountingPreferenceStore extends JsonPreferenceStore {
  saves = 0
  failNextSave = false

  override save(
    ...args: Parameters<JsonPreferenceStore["save"]>
  ): ReturnType<JsonPreferenceStore["save"]> {
    this.saves += 1
    if (this.failNextSave) {
      this.failNextSave = false
      return Promise.reject(new Error("Injected preference write failure."))
    }
    return super.save(...args)
  }
}

const createRouteFixture = async (
  approvalOptions?: Parameters<typeof createPendingApprovals>[0],
  requestBarriers: readonly {
    readonly path: string
    readonly wait: () => Promise<void>
  }[] = [],
  executeAction?: ReturnType<typeof createChatGenui>["executeGeneratedUiAction"],
) => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-routes-"))
  const chatSession = await JsonlChatSession.open(join(directory, "chat.jsonl"))
  const preferences = new CountingPreferenceStore(join(directory, "preferences.json"))
  const sessions = createAuthenticatedSessions()
  const owner = sessions.create()
  const other = sessions.create()
  const app = new Hono()
  for (const barrier of requestBarriers) {
    app.use(barrier.path, async (_context, next) => {
      await barrier.wait()
      await next()
    })
  }
  app.route(
    "/genui",
    createGenuiRoutes({
      sessions,
      chatSession,
      preferences,
      ...(approvalOptions === undefined ? {} : { approvalTesting: approvalOptions }),
      ...(executeAction === undefined ? {} : { executeGeneratedUiAction: executeAction }),
    }),
  )
  pendingApprovals.reset()

  return {
    app,
    chatSession,
    chatSessionPath: join(directory, "chat.jsonl"),
    preferences,
    owner,
    other,
    async dispose() {
      pendingApprovals.reset()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

void test("CHAT-APR-013 keeps tokens out of grants, ActionResult, audit, and telemetry", async () => {
  const audit: CallAuditEntry[] = []
  const telemetry: GenuiErrorEvent[] = []
  const chatGenui = createChatGenui({
    onCall: (entry) => {
      audit.push(entry)
    },
    onError: (event) => {
      telemetry.push(event)
    },
  })
  const tokens = ["pending-authority", "retry-authority"]
  const fixture = await createRouteFixture(
    { randomToken: () => tokens.shift() ?? "unexpected-authority" },
    [],
    chatGenui.executeGeneratedUiAction,
  )
  try {
    const surface = await chatGenui.generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "confined-approval",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const pendingResponse = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pendingEnvelope = parseExecuteEnvelope(await pendingResponse.json(), call)
    const pending = pendingEnvelope?.pendingApproval
    assert.ok(pending)
    const exchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval: unknown = await exchange.json()
    assert.ok(typeof approval === "object" && approval !== null && "retryToken" in approval)
    const retryToken = approval.retryToken
    assert.equal(typeof retryToken, "string")
    if (typeof retryToken !== "string") throw new Error("Expected retry authority.")

    fixture.preferences.failNextSave = true
    const retryResponse = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: retryToken },
      fixture.owner,
    )
    const retryEnvelope = parseExecuteEnvelope(await retryResponse.json(), call)
    assert.ok(retryEnvelope)

    await fixture.chatSession.appendTurn({
      userId: "confined-user",
      assistantId: "confined-assistant",
      prompt: "Save my preference.",
      assistantContent: [{ type: "surface", surface }],
    })
    const persisted = await readFile(fixture.chatSessionPath, "utf8")
    const restored = await JsonlChatSession.open(fixture.chatSessionPath)
    const faux = fauxProvider({ tokensPerSecond: 0 })
    faux.setResponses([
      (providerContext) => {
        const modelInput = JSON.stringify(providerContext.messages)
        assert.equal(modelInput.includes(pending.token) || modelInput.includes(retryToken), false)
        return fauxAssistantMessage("The restored context is confined.")
      },
    ])
    for await (const _event of await streamChatWithProvider(
      {
        history: restored.getHistory(),
        prompt: "Continue.",
        modelContext: undefined,
        preferences: fixture.preferences,
        subject: fixture.owner.subject,
        signal: new AbortController().signal,
      },
      faux.provider,
      faux.getModel(),
      "test-key",
    )) {
      // Drain the real model-input construction seam.
    }

    const confinedValues = [
      surface.grant,
      pendingEnvelope.result,
      retryEnvelope.result,
      audit,
      telemetry,
      telemetry.map((event) => String(event.cause)),
      persisted,
      restored.getHistory(),
    ]
    assert.equal(
      confinedValues.some((value) => {
        const serialized = JSON.stringify(value)
        return serialized.includes(pending.token) || serialized.includes(retryToken)
      }),
      false,
    )
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-014 session reset invalidates pending and retryable route authority", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const pendingCall = {
      surfaceId: surface.id,
      callId: "reset-pending-route",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const retryableCall = { ...pendingCall, callId: "reset-retryable-route" }
    const pendingResponse = await postJson(
      fixture.app,
      "/genui/execute",
      { call: pendingCall },
      fixture.owner,
    )
    const pending = parseExecuteEnvelope(await pendingResponse.json(), pendingCall)?.pendingApproval
    assert.ok(pending)
    const retryableResponse = await postJson(
      fixture.app,
      "/genui/execute",
      { call: retryableCall },
      fixture.owner,
    )
    const retryable = parseExecuteEnvelope(
      await retryableResponse.json(),
      retryableCall,
    )?.pendingApproval
    assert.ok(retryable)
    const exchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: retryable },
      fixture.owner,
    )
    const approval: unknown = await exchange.json()
    assert.ok(typeof approval === "object" && approval !== null && "retryToken" in approval)
    const retryToken = approval.retryToken
    assert.equal(typeof retryToken, "string")
    if (typeof retryToken !== "string") throw new Error("Expected retry authority.")

    await fixture.chatSession.reset(() => pendingApprovals.reset())

    const pendingAfterReset = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    assert.equal(pendingAfterReset.status, 403)
    const retryAfterReset = await postJson(
      fixture.app,
      "/genui/execute",
      { call: retryableCall, approvalRetryToken: retryToken },
      fixture.owner,
    )
    assert.deepEqual(await retryAfterReset.json(), {
      result: {
        ok: false,
        error: { code: "approval_denied", message: "Approval is unavailable." },
      },
    })
    assert.equal(fixture.preferences.saves, 0)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-007 rejects expired authority through the approval and execute routes", async () => {
  let now = 1_000
  const fixture = await createRouteFixture({ now: () => now, lifetimeMs: 10 })
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const pendingCall = {
      surfaceId: surface.id,
      callId: "route-pending-expiry",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const pendingResponse = await postJson(
      fixture.app,
      "/genui/execute",
      { call: pendingCall },
      fixture.owner,
    )
    const expiredPending = parseExecuteEnvelope(
      await pendingResponse.json(),
      pendingCall,
    )?.pendingApproval
    assert.ok(expiredPending)

    now += 10
    const expiredExchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: expiredPending },
      fixture.owner,
    )
    assert.equal(expiredExchange.status, 403)
    assert.deepEqual(await expiredExchange.json(), { error: "Approval is unavailable." })

    const retryCall = { ...pendingCall, callId: "route-retry-expiry" }
    const retryPendingResponse = await postJson(
      fixture.app,
      "/genui/execute",
      { call: retryCall },
      fixture.owner,
    )
    const retryPending = parseExecuteEnvelope(
      await retryPendingResponse.json(),
      retryCall,
    )?.pendingApproval
    assert.ok(retryPending)
    const exchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: retryPending },
      fixture.owner,
    )
    const approval = await exchange.json()
    assert.equal(typeof approval.retryToken, "string")

    now += 10
    const expiredRetry = await postJson(
      fixture.app,
      "/genui/execute",
      { call: retryCall, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await expiredRetry.json(), retryCall), {
      result: {
        ok: false,
        error: { code: "approval_denied", message: "Approval is unavailable." },
      },
    })
    assert.equal(await fixture.preferences.get(), undefined)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-008 gives concurrent route exchange and consumption one winner", async () => {
  const exchangeBarrier = createRequestBarrier(2)
  const consumptionBarrier = createRequestBarrier(2)
  const fixture = await createRouteFixture(undefined, [
    { path: "/genui/approve", wait: exchangeBarrier.wait },
    { path: "/genui/execute", wait: consumptionBarrier.wait },
  ])
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "concurrent-route-consumption",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const pendingResponse = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await pendingResponse.json(), call)?.pendingApproval
    assert.ok(pending)

    exchangeBarrier.enable()
    const exchanges = await Promise.all([
      postJson(fixture.app, "/genui/approve", { pendingApproval: pending }, fixture.owner),
      postJson(fixture.app, "/genui/approve", { pendingApproval: pending }, fixture.owner),
    ])
    assert.deepEqual(
      exchanges.map((response) => response.status).sort((left, right) => left - right),
      [200, 403],
    )
    const approvedExchange = exchanges.find((response) => response.status === 200)
    assert.ok(approvedExchange)
    const approval = await approvedExchange.json()
    assert.equal(typeof approval.retryToken, "string")

    consumptionBarrier.enable()
    const retries = await Promise.all([
      postJson(
        fixture.app,
        "/genui/execute",
        { call, approvalRetryToken: approval.retryToken },
        fixture.owner,
      ),
      postJson(
        fixture.app,
        "/genui/execute",
        { call, approvalRetryToken: approval.retryToken },
        fixture.owner,
      ),
    ])
    const results = await Promise.all(
      retries.map(async (response) => parseExecuteEnvelope(await response.json(), call)?.result),
    )
    assert.deepEqual(results, [
      { ok: true, value: { preference: "City" } },
      { ok: true, value: { preference: "City" } },
    ])
    assert.equal(fixture.preferences.saves, 1)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-009 replays a completed result without reusing consumed authority", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "completed-replay",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const pendingResponse = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await pendingResponse.json(), call)?.pendingApproval
    assert.ok(pending)
    const exchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval = await exchange.json()
    assert.equal(typeof approval.retryToken, "string")

    const execute = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    const completed = parseExecuteEnvelope(await execute.json(), call)
    assert.deepEqual(completed, { result: { ok: true, value: { preference: "City" } } })
    assert.equal(fixture.preferences.saves, 1)

    const replay = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await replay.json(), call), completed)
    assert.equal(fixture.preferences.saves, 1)

    const conflictCall = { ...call, input: { preference: "Mountain" } }
    const conflict = await postJson(
      fixture.app,
      "/genui/execute",
      { call: conflictCall, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await conflict.json(), conflictCall), {
      result: {
        ok: false,
        error: { code: "invalid_input", message: "Call ID was reused with different input." },
      },
    })

    const changedCall = { ...call, callId: "changed-call" }
    const changed = await postJson(
      fixture.app,
      "/genui/execute",
      { call: changedCall, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await changed.json(), changedCall), {
      result: {
        ok: false,
        error: { code: "approval_denied", message: "Approval is unavailable." },
      },
    })
    assert.equal(fixture.preferences.saves, 1)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-009 consumes retry authority before a failed execution", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "failed-replay",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const pendingResponse = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await pendingResponse.json(), call)?.pendingApproval
    assert.ok(pending)
    const exchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval = await exchange.json()
    assert.equal(typeof approval.retryToken, "string")
    fixture.preferences.failNextSave = true

    const execute = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    const failed = parseExecuteEnvelope(await execute.json(), call)
    assert.deepEqual(failed, {
      result: { ok: false, error: { code: "execution_failed", message: "Action failed." } },
    })
    assert.equal(fixture.preferences.saves, 1)

    const replay = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await replay.json(), call), failed)
    assert.equal(fixture.preferences.saves, 1)

    const conflictCall = { ...call, input: { preference: "Mountain" } }
    const conflict = await postJson(
      fixture.app,
      "/genui/execute",
      { call: conflictCall, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await conflict.json(), conflictCall), {
      result: {
        ok: false,
        error: { code: "invalid_input", message: "Call ID was reused with different input." },
      },
    })
    assert.equal(fixture.preferences.saves, 1)
    assert.equal(await fixture.preferences.get(), undefined)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-003 crosses the execute HTTP authentication boundary", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const otherCall = {
      surfaceId: surface.id,
      callId: "other-session-save",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall

    const unauthenticated = await postJson(fixture.app, "/genui/execute", "malformed")
    assert.equal(unauthenticated.status, 401)
    assert.deepEqual(await unauthenticated.json(), {
      result: {
        ok: false,
        error: { code: "unknown_surface", message: "Authentication is required." },
      },
    })

    const invalidCsrf = await postJson(
      fixture.app,
      "/genui/execute",
      { call: otherCall },
      fixture.owner,
      "invalid",
    )
    assert.equal(invalidCsrf.status, 401)

    const wrongSubject = await postJson(
      fixture.app,
      "/genui/execute",
      { call: otherCall },
      fixture.other,
    )
    assert.equal(wrongSubject.status, 200)
    assert.deepEqual(await wrongSubject.json(), {
      result: {
        ok: false,
        error: { code: "not_granted", message: "Surface is not granted to this subject." },
      },
    })
    assert.equal(pendingApprovals.pending(otherCall, fixture.other.subject), undefined)
    assert.equal(await fixture.preferences.get(), undefined)

    const ownerCall = { ...otherCall, callId: "owner-save" }
    const owner = await postJson(fixture.app, "/genui/execute", { call: ownerCall }, fixture.owner)
    assert.equal(owner.status, 200)
    const ownerEnvelope = parseExecuteEnvelope(await owner.json(), ownerCall)
    assert.deepEqual(ownerEnvelope?.result, {
      ok: false,
      error: {
        code: "approval_required",
        message: 'Save "City" as your preferred trip',
      },
    })
    assert.equal(typeof ownerEnvelope?.pendingApproval?.token, "string")
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-005 and CHAT-APR-010 exchange only authenticated CSRF-protected pending authority", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "exchange-save",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const first = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await first.json(), call)?.pendingApproval
    assert.ok(pending)

    const unauthenticated = await postJson(fixture.app, "/genui/approve", {
      pendingApproval: pending,
    })
    assert.equal(unauthenticated.status, 401)
    const invalidCsrf = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
      "invalid",
    )
    assert.equal(invalidCsrf.status, 401)

    const approved = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    assert.equal(approved.status, 200)
    const body = await approved.json()
    assert.equal(typeof body.retryToken, "string")
    assert.notEqual(body.retryToken, pending.token)
    const retry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: body.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await retry.json(), call), {
      result: { ok: true, value: { preference: "City" } },
    })
    assert.equal((await fixture.preferences.get())?.preferredTrip, "City")
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-004 rejects every pending binding mismatch without consuming authority", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "mismatched-exchange",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const first = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await first.json(), call)?.pendingApproval
    assert.ok(pending)

    const mismatches = [
      { request: { ...pending, surfaceId: "other-surface" }, session: fixture.owner },
      { request: { ...pending, callId: "other-call" }, session: fixture.owner },
      { request: { ...pending, action: "preferences.delete" }, session: fixture.owner },
      { request: { ...pending, input: { preference: "Mountain" } }, session: fixture.owner },
      { request: { ...pending, token: "guest-token" }, session: fixture.owner },
      { request: pending, session: fixture.other },
    ] as const

    for (const mismatch of mismatches) {
      const response = await postJson(
        fixture.app,
        "/genui/approve",
        { pendingApproval: mismatch.request },
        mismatch.session,
      )
      assert.equal(response.status, 403)
      const body = await response.json()
      assert.deepEqual(body, { error: "Approval is unavailable." })
      assert.equal(JSON.stringify(body).includes(pending.token), false)
      assert.equal(await fixture.preferences.get(), undefined)
    }

    const approved = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval = await approved.json()
    assert.equal(approved.status, 200)
    assert.equal(typeof approval.retryToken, "string")
    const retry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await retry.json(), call), {
      result: { ok: true, value: { preference: "City" } },
    })
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-004 leaves retry authority usable after every request mismatch", async () => {
  const fixture = await createRouteFixture()
  const originalFetch = globalThis.fetch
  let searches = 0
  globalThis.fetch = async () => {
    searches += 1
    throw new Error("Web search must not run for a mismatched approval request.")
  }
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "mismatched-retry",
      action: "preferences.save",
      input: { preference: "  City  " },
    } satisfies ActionCall
    const first = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await first.json(), call)?.pendingApproval
    assert.ok(pending)
    assert.deepEqual(pending.input, { preference: "City" })
    const approved = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval = await approved.json()
    const retryToken: unknown = approval.retryToken
    assert.equal(typeof retryToken, "string")
    if (typeof retryToken !== "string") throw new Error("Expected a retry token.")

    const mismatches: readonly {
      readonly call: ActionCall
      readonly session: AuthenticatedSession
      readonly retryToken?: string
    }[] = [
      { call, session: fixture.other, retryToken },
      { call: { ...call, surfaceId: "other-surface" }, session: fixture.owner, retryToken },
      { call: { ...call, callId: "other-call" }, session: fixture.owner, retryToken },
      {
        call: { ...call, action: "web.search", input: { query: "safe destinations" } },
        session: fixture.owner,
        retryToken,
      },
      {
        call: { ...call, input: { preference: "Mountain" } },
        session: fixture.owner,
        retryToken,
      },
      { call, session: fixture.owner, retryToken: "guest-token" },
      { call, session: fixture.owner },
    ]
    for (const mismatch of mismatches) {
      const response = await postJson(
        fixture.app,
        "/genui/execute",
        {
          call: mismatch.call,
          ...(mismatch.retryToken === undefined ? {} : { approvalRetryToken: mismatch.retryToken }),
        },
        mismatch.session,
      )
      const envelope = parseExecuteEnvelope(await response.json(), mismatch.call)
      assert.equal(response.status, 200)
      assert.equal(envelope?.result.ok, false)
      assert.equal(envelope?.pendingApproval, undefined)
      assert.equal(await fixture.preferences.get(), undefined)
    }
    assert.equal(searches, 0)

    const retry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: retryToken },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await retry.json(), call), {
      result: { ok: true, value: { preference: "City" } },
    })
    assert.equal((await fixture.preferences.get())?.preferredTrip, "City")
  } finally {
    globalThis.fetch = originalFetch
    await fixture.dispose()
  }
})

void test("CHAT-APR-002 rejects forged preapproval without creating authority", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "forged-preapproval",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const forgedPending = { ...call, token: "guest-token" }

    const forgedExchange = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: forgedPending },
      fixture.owner,
    )
    assert.equal(forgedExchange.status, 403)
    assert.deepEqual(await forgedExchange.json(), { error: "Approval is unavailable." })

    for (const preapproval of [
      { call, approved: true },
      { call, pendingApproval: forgedPending },
    ]) {
      const response = await postJson(fixture.app, "/genui/execute", preapproval, fixture.owner)
      assert.equal(response.status, 400)
    }
    const guestRetry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: "guest-token" },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await guestRetry.json(), call), {
      result: {
        ok: false,
        error: { code: "approval_denied", message: "Approval is unavailable." },
      },
    })
    assert.equal(pendingApprovals.pending(call, fixture.owner.subject), undefined)
    assert.equal(await fixture.preferences.get(), undefined)

    const valid = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    assert.equal(
      typeof parseExecuteEnvelope(await valid.json(), call)?.pendingApproval?.token,
      "string",
    )
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-002 rejects a guest token before a granted read handler runs", async () => {
  const fixture = await createRouteFixture()
  const originalFetch = globalThis.fetch
  let searches = 0
  globalThis.fetch = async () => {
    searches += 1
    throw new Error("Web search must not run for a forged approval request.")
  }
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Search</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "forged-read",
      action: "web.search",
      input: { query: "safe destinations" },
    } satisfies ActionCall

    const response = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: "guest-token" },
      fixture.owner,
    )
    assert.deepEqual(parseExecuteEnvelope(await response.json(), call), {
      result: {
        ok: false,
        error: { code: "approval_denied", message: "Approval is unavailable." },
      },
    })
    assert.equal(searches, 0)
    assert.equal(pendingApprovals.pending(call, fixture.owner.subject), undefined)
  } finally {
    globalThis.fetch = originalFetch
    await fixture.dispose()
  }
})

void test("CHAT-APR-011 rejects malformed route envelopes without changing approval state", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Trips</p>",
      subject: fixture.owner.subject,
    })
    const call = {
      surfaceId: surface.id,
      callId: "malformed-envelopes",
      action: "preferences.save",
      input: { preference: "City" },
    } satisfies ActionCall
    const malformedExecuteRequests: readonly unknown[] = [
      {},
      { call, approvalRetryToken: "" },
      { call: { ...call, extra: true } },
      { call: { ...call, surfaceId: "" } },
    ]
    for (const request of malformedExecuteRequests) {
      const response = await postJson(fixture.app, "/genui/execute", request, fixture.owner)
      assert.equal(response.status, 400)
      const body = await response.json()
      assert.deepEqual(body, {
        result: {
          ok: false,
          error: { code: "invalid_input", message: "Malformed GenUI action call." },
        },
      })
      assert.doesNotMatch(JSON.stringify(body), /token/iu)
    }
    assert.equal(pendingApprovals.pending(call, fixture.owner.subject), undefined)

    const first = await postJson(fixture.app, "/genui/execute", { call }, fixture.owner)
    const pending = parseExecuteEnvelope(await first.json(), call)?.pendingApproval
    assert.ok(pending)
    const malformedExchanges: readonly unknown[] = [
      {},
      { pendingApproval: pending, extra: true },
      { pendingApproval: { ...pending, token: "" } },
      { pendingApproval: { ...pending, action: "invalid" } },
      { pendingApproval: { ...pending, input: undefined } },
    ]
    for (const request of malformedExchanges) {
      const response = await postJson(fixture.app, "/genui/approve", request, fixture.owner)
      assert.equal(response.status, 400)
      const body = await response.json()
      assert.deepEqual(body, { error: "Malformed approval request." })
      assert.equal(JSON.stringify(body).includes(pending.token), false)
      assert.equal(await fixture.preferences.get(), undefined)
    }

    const approved = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    const approval = await approved.json()
    assert.equal(typeof approval.retryToken, "string")
    const malformedRetry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: "" },
      fixture.owner,
    )
    assert.equal(malformedRetry.status, 400)
    assert.equal(await fixture.preferences.get(), undefined)

    const retry = await postJson(
      fixture.app,
      "/genui/execute",
      { call, approvalRetryToken: approval.retryToken },
      fixture.owner,
    )
    assert.equal(parseExecuteEnvelope(await retry.json(), call)?.result.ok, true)
    const saved = await fixture.preferences.get()
    assert.equal(saved?.preferredTrip, "City")

    const consumed = await postJson(
      fixture.app,
      "/genui/approve",
      { pendingApproval: pending },
      fixture.owner,
    )
    assert.equal(consumed.status, 403)
    assert.deepEqual(await consumed.json(), { error: "Approval is unavailable." })
    assert.deepEqual(await fixture.preferences.get(), saved)
  } finally {
    await fixture.dispose()
  }
})

void test("CHAT-APR-003 crosses the subscription HTTP authentication boundary", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Clock</p>",
      subject: fixture.owner.subject,
    })
    const request = {
      surfaceId: surface.id,
      subscriptionId: "clock-other",
      subscription: "time.tick",
      input: {},
    } satisfies SubscriptionRequest

    const unauthenticated = await postJson(fixture.app, "/genui/subscribe", "malformed")
    assert.equal(unauthenticated.status, 401)
    assert.deepEqual(await unauthenticated.json(), {
      ok: false,
      error: { code: "unknown_surface", message: "Authentication is required." },
    })

    const wrongSubject = await postJson(fixture.app, "/genui/subscribe", request, fixture.other)
    assert.equal(wrongSubject.status, 400)
    assert.deepEqual(await wrongSubject.json(), {
      ok: false,
      error: { code: "not_granted", message: "Surface is not granted to this subject." },
    })

    const ownerRequest = { ...request, subscriptionId: "clock-owner" }
    const owner = await postJson(fixture.app, "/genui/subscribe", ownerRequest, fixture.owner)
    assert.equal(owner.status, 200)
    const reader = owner.body?.getReader()
    assert.ok(reader)
    const first = await reader.read()
    assert.equal(first.done, false)
    assert.match(new TextDecoder().decode(first.value), /"type":"event"/u)
    await reader.cancel()
  } finally {
    await fixture.dispose()
  }
})

void test("snapshot writes require CSRF and a matching surface subject", async () => {
  const fixture = await createRouteFixture()
  try {
    const surface = await generatedUi.createSurface({
      content: "<p>Counter</p>",
      subject: fixture.owner.subject,
    })
    await fixture.chatSession.appendTurn({
      userId: "snapshot-user",
      assistantId: "snapshot-assistant",
      prompt: "Make a counter",
      assistantContent: [{ type: "surface", surface }],
    })
    const snapshots = [{ surfaceId: surface.id, snapshot: { count: 1 } }]

    const unauthenticated = await postJson(fixture.app, "/genui/snapshots", snapshots)
    assert.equal(unauthenticated.status, 401)

    const invalidCsrf = await postJson(
      fixture.app,
      "/genui/snapshots",
      snapshots,
      fixture.owner,
      "invalid",
    )
    assert.equal(invalidCsrf.status, 401)

    const wrongSubject = await postJson(fixture.app, "/genui/snapshots", snapshots, fixture.other)
    assert.equal(wrongSubject.status, 403)
    assert.equal(fixture.chatSession.getSurfaceSnapshot(surface.id), undefined)

    const owner = await postJson(fixture.app, "/genui/snapshots", snapshots, fixture.owner)
    assert.equal(owner.status, 204)
    assert.deepEqual(fixture.chatSession.getSurfaceSnapshot(surface.id), { count: 1 })
  } finally {
    await fixture.dispose()
  }
})
