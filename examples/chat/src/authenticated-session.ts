import { randomUUID } from "node:crypto"

export interface AuthenticatedSession {
  readonly credential: string
  readonly csrfToken: string
  readonly subject: string
}

const sessions = new Map<string, AuthenticatedSession>()

export const authenticatedSessions = {
  create(): AuthenticatedSession {
    const session = { credential: randomUUID(), csrfToken: randomUUID(), subject: randomUUID() }
    sessions.set(session.credential, session)
    return session
  },
  get(credential: string | undefined): AuthenticatedSession | undefined {
    return credential === undefined ? undefined : sessions.get(credential)
  },
}
