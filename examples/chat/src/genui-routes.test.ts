import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Hono } from "hono"
import type { ActionCall, SubscriptionRequest } from "genui/protocol"
import { generatedUi } from "./ai/genui.js"
import { createAuthenticatedSessions, type AuthenticatedSession } from "./authenticated-session.js"
import { parseExecuteEnvelope, pendingApprovals } from "./approval.js"
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

const createRouteFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-routes-"))
  const chatSession = await JsonlChatSession.open(join(directory, "chat.jsonl"))
  const preferences = new JsonPreferenceStore(join(directory, "preferences.json"))
  const sessions = createAuthenticatedSessions()
  const owner = sessions.create()
  const other = sessions.create()
  const app = new Hono().route("/genui", createGenuiRoutes({ sessions, chatSession, preferences }))
  pendingApprovals.clear()

  return {
    app,
    chatSession,
    preferences,
    owner,
    other,
    async dispose() {
      pendingApprovals.clear()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

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
