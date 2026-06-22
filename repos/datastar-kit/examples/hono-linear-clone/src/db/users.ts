import { eq } from "drizzle-orm"
import { db } from "./index.js"
import { users } from "./schema.js"
import { hashPassword, verifyPassword } from "../auth/passwords.js"

export const createUser = async (input: { name: string; username: string; password: string }) => {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      username: input.username.toLowerCase(),
      passwordHash: await hashPassword(input.password)
    })
    .onConflictDoNothing({ target: users.username })
    .returning()

  if (user === undefined) {
    return null
  }

  return user
}

export const authenticate = async (input: { username: string; password: string }) => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username.toLowerCase()))
    .limit(1)

  if (user === undefined || !(await verifyPassword(input.password, user.passwordHash))) {
    return null
  }

  return user
}
