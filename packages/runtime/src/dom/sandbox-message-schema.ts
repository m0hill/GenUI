import { isRecord } from "../record.js"
import { parseActionCall, type ActionCall } from "../types.js"
import { protocolChannel } from "./protocol.js"

export interface ActionSandboxMessage extends ActionCall {
  readonly channel: typeof protocolChannel
  readonly type?: undefined
}

interface ResizeSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "resize"
  readonly surfaceId: string
  readonly height: number
}

interface GuestErrorSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "guest_error"
  readonly surfaceId: string
  readonly message: string
  readonly stack?: string
}

export type SandboxMessage = ActionSandboxMessage | ResizeSandboxMessage | GuestErrorSandboxMessage

export type ParseSandboxMessageResult =
  | { readonly ok: true; readonly value: SandboxMessage }
  | { readonly ok: false; readonly reason: "unknown_channel" | "bad_message" }

const maxIdentifierLength = 256
const maxGuestErrorMessageLength = 2_048
const maxGuestErrorStackLength = 8_192

const boundedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" && value.length <= maxLength ? value : undefined

const truncatedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string"
    ? value.length <= maxLength
      ? value
      : `${value.slice(0, maxLength - 3)}...`
    : undefined

const parseActionMessage = (
  value: Readonly<Record<string, unknown>>,
): ActionSandboxMessage | undefined => {
  const call = parseActionCall(value)
  if (call === undefined) return undefined
  if (call.surfaceId.length > maxIdentifierLength || call.callId.length > maxIdentifierLength) {
    return undefined
  }
  if (call.action.length > maxIdentifierLength) return undefined
  return { channel: protocolChannel, ...call }
}

const parseResizeMessage = (
  value: Readonly<Record<string, unknown>>,
): ResizeSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  if (surfaceId === undefined) return undefined
  if (typeof value.height !== "number" || !Number.isFinite(value.height)) return undefined
  return { channel: protocolChannel, type: "resize", surfaceId, height: value.height }
}

const parseGuestErrorMessage = (
  value: Readonly<Record<string, unknown>>,
): GuestErrorSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  const message = truncatedString(value.message, maxGuestErrorMessageLength)
  const stack =
    value.stack === undefined ? undefined : truncatedString(value.stack, maxGuestErrorStackLength)
  if (surfaceId === undefined || message === undefined) return undefined
  if (value.stack !== undefined && stack === undefined) return undefined
  return {
    channel: protocolChannel,
    type: "guest_error",
    surfaceId,
    message,
    ...(stack === undefined ? {} : { stack }),
  }
}

export const parseSandboxMessage = (value: unknown): ParseSandboxMessageResult => {
  if (!isRecord(value)) return { ok: false, reason: "bad_message" }
  if (value.channel !== protocolChannel) return { ok: false, reason: "unknown_channel" }

  const message =
    value.type === undefined
      ? parseActionMessage(value)
      : value.type === "resize"
        ? parseResizeMessage(value)
        : value.type === "guest_error"
          ? parseGuestErrorMessage(value)
          : undefined
  return message === undefined ? { ok: false, reason: "bad_message" } : { ok: true, value: message }
}
