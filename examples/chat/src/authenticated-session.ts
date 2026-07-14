import { randomUUID } from "node:crypto"

export interface AuthenticatedSession {
  readonly credential: string
  readonly csrfToken: string
  readonly subject: string
}

/** Create an isolated chat session registry for production bootstrap or route tests. */
export const createAuthenticatedSessions = () => {
  const sessions = new Map<string, AuthenticatedSession>()
  return {
    create() {
      const session = { credential: randomUUID(), csrfToken: randomUUID(), subject: randomUUID() }
      sessions.set(session.credential, session)
      return session
    },
    get(credential: string | undefined) {
      return credential === undefined ? undefined : sessions.get(credential)
    },
  }
}

/** Concrete in-memory sessions used by the single-process chat example. */
export type AuthenticatedSessionRegistry = ReturnType<typeof createAuthenticatedSessions>

/** Resolve the trusted chat session credential from an HTTP request. */
export const authenticatedSessionFromRequest = (
  sessions: AuthenticatedSessionRegistry,
  request: Request,
): AuthenticatedSession | undefined => {
  const credential = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([name]) => name === "chat_session")?.[1]
  return sessions.get(credential)
}

/** Serialize the chat credential cookie without breaking cross-site top-level navigation. */
export const serializeAuthenticatedSessionCookie = (session: AuthenticatedSession): string =>
  `chat_session=${session.credential}; HttpOnly; SameSite=Lax; Path=/`

export const authenticatedSessions = createAuthenticatedSessions()
