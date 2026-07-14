import assert from "node:assert/strict"
import test from "node:test"
import {
  createAuthenticatedSessions,
  serializeAuthenticatedSessionCookie,
} from "./authenticated-session.js"

void test("chat session cookies survive cross-site top-level navigation", () => {
  const session = createAuthenticatedSessions().create()
  const cookie = serializeAuthenticatedSessionCookie(session)

  assert.match(cookie, /(?:^|;) HttpOnly(?:;|$)/u)
  assert.match(cookie, /(?:^|;) SameSite=Lax(?:;|$)/u)
  assert.doesNotMatch(cookie, /SameSite=Strict/u)
})
