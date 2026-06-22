import { randomBytes } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import { deleteCookie, generateCookie, getCookie } from "hono/cookie"
import type { AppBindings } from "../app.js"
import { db } from "../db/index.js"
import { sessions, users, type User } from "../db/schema.js"

const cookieName = "linear_session"
const sessionMs = 1000 * 60 * 60 * 24 * 14

export const createSession = async (userId: number) => {
  const id = randomBytes(32).toString("base64url")
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + sessionMs)
  })
  return id
}

export const sessionCookie = (sessionId: string) =>
  generateCookie(cookieName, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(sessionMs / 1000)
  })

export const deleteSessionCookie = (c: Context<AppBindings>) =>
  deleteCookie(c, cookieName, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0
  })

export const deleteSession = async (sessionId: string | undefined) => {
  if (sessionId !== undefined) {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }
}

export const getCurrentUser = async (c: Context<AppBindings>): Promise<User | null> => {
  const sessionId = getCookie(c, cookieName)
  if (sessionId === undefined) {
    return null
  }

  const [session] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1)

  return session?.user ?? null
}

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = await getCurrentUser(c)
  if (user === null) {
    return c.redirect("/login")
  }

  c.set("user", user)
  return next()
}
