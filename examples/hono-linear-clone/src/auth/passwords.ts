import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const scryptAsync = (password: string | Buffer, salt: string | Buffer, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error !== null) {
        reject(error)
        return
      }

      resolve(derivedKey)
    })
  })

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("base64url")
  const key = await scryptAsync(password, salt, 64)
  return `scrypt:${salt}:${key.toString("base64url")}`
}

export const verifyPassword = async (password: string, stored: string) => {
  const [scheme, salt, encoded] = stored.split(":")
  if (scheme !== "scrypt" || salt === undefined || encoded === undefined) {
    return false
  }

  const expected = Buffer.from(encoded, "base64url")
  const actual = await scryptAsync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
