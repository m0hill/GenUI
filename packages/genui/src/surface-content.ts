import { maxSurfaceContentBytes } from "./protocol/index.js"

const utf8Encoder = new TextEncoder()

const surfaceContentByteLength = (content: string): number => utf8Encoder.encode(content).byteLength

export const isSurfaceContentWithinLimit = (content: string): boolean =>
  surfaceContentByteLength(content) <= maxSurfaceContentBytes

export const assertSurfaceContentWithinLimit = (content: string): void => {
  if (isSurfaceContentWithinLimit(content)) return
  throw new RangeError(
    `Surface content must be at most ${String(maxSurfaceContentBytes)} UTF-8 bytes.`,
  )
}
