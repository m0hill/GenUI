import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { GenuiRuntimeManifest } from "./default-primitives.js"

export interface GeneratedSurfaceRecord {
  readonly id: string
  readonly token: string
  readonly chatId: string
  readonly toolCallId: string
  readonly htmlHash: string
  readonly grantHash: string
  readonly manifest: GenuiRuntimeManifest
}

interface RegisterGeneratedSurfaceInput {
  readonly chatId: string
  readonly toolCallId: string
  readonly html: string
  readonly manifest: GenuiRuntimeManifest
}

interface VerifyGeneratedSurfaceGrantInput {
  readonly surfaceId: string
  readonly surfaceToken: string
  readonly chatId?: string
  readonly capability: string
}

type VerifyGeneratedSurfaceGrantResult =
  | { readonly ok: true; readonly surface: GeneratedSurfaceRecord }
  | { readonly ok: false; readonly code: string; readonly error: string }

const records = new Map<string, GeneratedSurfaceRecord>()
const processSecret = randomBytes(32)

const hashText = (value: string): string => createHash("sha256").update(value).digest("hex")

const grantHash = (manifest: GenuiRuntimeManifest): string =>
  hashText(
    JSON.stringify({
      capabilities: manifest.capabilities.map((capability) => capability.name),
      actions: manifest.actions.map((action) => action.name),
      pluginAttributes: manifest.pluginAttributes.map((attribute) => attribute.name),
    }),
  )

const surfaceId = (chatId: string, toolCallId: string): string =>
  `surface-${hashText(`${chatId}:${toolCallId}`).slice(0, 24)}`

const surfaceToken = (
  id: string,
  chatId: string,
  toolCallId: string,
  currentGrantHash: string,
): string =>
  createHmac("sha256", processSecret)
    .update(`${id}:${chatId}:${toolCallId}:${currentGrantHash}`)
    .digest("base64url")

const equalToken = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export const registerGeneratedSurface = (
  input: RegisterGeneratedSurfaceInput,
): GeneratedSurfaceRecord => {
  const id = surfaceId(input.chatId, input.toolCallId)
  const currentGrantHash = grantHash(input.manifest)
  const record: GeneratedSurfaceRecord = {
    id,
    token: surfaceToken(id, input.chatId, input.toolCallId, currentGrantHash),
    chatId: input.chatId,
    toolCallId: input.toolCallId,
    htmlHash: hashText(input.html),
    grantHash: currentGrantHash,
    manifest: input.manifest,
  }

  records.set(record.id, record)
  return record
}

export const verifyGeneratedSurfaceGrant = (
  input: VerifyGeneratedSurfaceGrantInput,
): VerifyGeneratedSurfaceGrantResult => {
  const surface = records.get(input.surfaceId)
  if (surface === undefined) {
    return { ok: false, code: "surface_not_found", error: "Generated surface is not available." }
  }

  if (input.chatId !== undefined && input.chatId !== surface.chatId) {
    return { ok: false, code: "surface_chat_mismatch", error: "Generated surface is invalid." }
  }

  if (!equalToken(input.surfaceToken, surface.token)) {
    return { ok: false, code: "surface_token_invalid", error: "Generated surface is invalid." }
  }

  const capabilityGranted = surface.manifest.capabilities.some(
    (capability) => capability.name === input.capability,
  )
  if (!capabilityGranted) {
    return {
      ok: false,
      code: "capability_not_granted",
      error: "Capability is not granted to this generated surface.",
    }
  }

  return { ok: true, surface }
}
