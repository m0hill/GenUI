import { isValidSubscriptionName, parseActionCall, type ActionCall } from "../protocol/index.js"
import type {
  OpenLinkParams,
  SendMessageParams,
  UpdateModelContextParams,
} from "./host-capabilities.js"
import { protocolChannel } from "./protocol.js"

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface ActionSandboxMessage extends ActionCall {
  readonly channel: typeof protocolChannel
  readonly type?: undefined
}

/** JSON value captured from or restored into untrusted generated content. */
export type SnapshotValue =
  | null
  | boolean
  | number
  | string
  | readonly SnapshotValue[]
  | { readonly [key: string]: SnapshotValue }

interface HeartbeatSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "heartbeat"
  readonly surfaceId: string
}

interface ResizeSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "resize"
  readonly surfaceId: string
  readonly width: number
  readonly height: number
}

interface GuestErrorSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "guest_error"
  readonly surfaceId: string
  readonly message: string
  readonly stack?: string
}

export type SnapshotSandboxMessage =
  | {
      readonly channel: typeof protocolChannel
      readonly type: "snapshot"
      readonly surfaceId: string
      readonly requestId: string
      readonly ok: true
      readonly value: SnapshotValue
    }
  | {
      readonly channel: typeof protocolChannel
      readonly type: "snapshot"
      readonly surfaceId: string
      readonly requestId: string
      readonly ok: false
    }

export type TeardownSandboxMessage =
  | {
      readonly channel: typeof protocolChannel
      readonly type: "teardown"
      readonly surfaceId: string
      readonly requestId: string
      readonly ok: true
      readonly value?: SnapshotValue
    }
  | {
      readonly channel: typeof protocolChannel
      readonly type: "teardown"
      readonly surfaceId: string
      readonly requestId: string
      readonly ok: false
    }

export interface SendMessageSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "capability_call"
  readonly surfaceId: string
  readonly callId: string
  readonly capability: "ui/message"
  readonly params: SendMessageParams
}

export interface OpenLinkSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "capability_call"
  readonly surfaceId: string
  readonly callId: string
  readonly capability: "ui/open-link"
  readonly params: OpenLinkParams
}

export interface UpdateModelContextSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "capability_call"
  readonly surfaceId: string
  readonly callId: string
  readonly capability: "ui/update-model-context"
  readonly params: UpdateModelContextParams
}

export type CapabilitySandboxMessage =
  | SendMessageSandboxMessage
  | OpenLinkSandboxMessage
  | UpdateModelContextSandboxMessage

export interface SubscriptionStartSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_start"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly subscription: string
  readonly input: SnapshotValue
}

export interface SubscriptionAckSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_ack"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly sequence: number
}

export interface SubscriptionUnsubscribeSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_unsubscribe"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
}

export interface SubscriptionCancelSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "subscription_cancel"
  readonly surfaceId: string
  readonly documentId: string
  readonly subscriptionId: string
  readonly reason: "handler_failed" | "overflow"
}

export type SubscriptionSandboxMessage =
  | SubscriptionStartSandboxMessage
  | SubscriptionAckSandboxMessage
  | SubscriptionUnsubscribeSandboxMessage
  | SubscriptionCancelSandboxMessage

export type SandboxMessage =
  | ActionSandboxMessage
  | HeartbeatSandboxMessage
  | ResizeSandboxMessage
  | GuestErrorSandboxMessage
  | SnapshotSandboxMessage
  | TeardownSandboxMessage
  | CapabilitySandboxMessage
  | SubscriptionSandboxMessage

type ParseSandboxMessageResult =
  | { readonly ok: true; readonly value: SandboxMessage }
  | { readonly ok: false; readonly reason: "unknown_channel" | "bad_message" }

const maxIdentifierLength = 256
const maxGuestErrorMessageLength = 2_048
const maxGuestErrorStackLength = 8_192

export const parseSnapshotValue = (value: unknown): SnapshotValue | undefined => {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) return undefined
    // SAFETY: parsing JSON.stringify output can produce only recursive JSON values.
    return JSON.parse(encoded) as SnapshotValue
  } catch {
    return undefined
  }
}

const boundedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" && value.length <= maxLength ? value : undefined

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key))

const capabilityMessageKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "callId",
  "capability",
  "params",
])
const sendMessageParamKeys: ReadonlySet<string> = new Set(["role", "content"])
const textContentKeys: ReadonlySet<string> = new Set(["type", "text"])
const openLinkParamKeys: ReadonlySet<string> = new Set(["url"])
const updateModelContextParamKeys: ReadonlySet<string> = new Set(["content", "structuredContent"])
const subscriptionStartKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "documentId",
  "subscriptionId",
  "subscription",
  "input",
])
const subscriptionAckKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "documentId",
  "subscriptionId",
  "sequence",
])
const subscriptionUnsubscribeKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "documentId",
  "subscriptionId",
])
const subscriptionCancelKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "documentId",
  "subscriptionId",
  "reason",
])
const resizeMessageKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "width",
  "height",
])
const teardownSuccessKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "requestId",
  "ok",
  "value",
])
const teardownFailureKeys: ReadonlySet<string> = new Set([
  "channel",
  "type",
  "surfaceId",
  "requestId",
  "ok",
])

const parseCapabilityMessage = (
  value: Readonly<Record<string, unknown>>,
): CapabilitySandboxMessage | undefined => {
  if (!hasOnlyKeys(value, capabilityMessageKeys)) return undefined
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  const callId = boundedString(value.callId, maxIdentifierLength)
  if (surfaceId === undefined || callId === undefined || !isRecord(value.params)) return undefined

  if (value.capability === "ui/message") {
    if (!hasOnlyKeys(value.params, sendMessageParamKeys)) return undefined
    const content = value.params.content
    if (
      value.params.role !== "user" ||
      !isRecord(content) ||
      !hasOnlyKeys(content, textContentKeys) ||
      content.type !== "text" ||
      typeof content.text !== "string"
    ) {
      return undefined
    }
    return {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId,
      callId,
      capability: "ui/message",
      params: { role: "user", content: { type: "text", text: content.text } },
    }
  }

  if (
    value.capability === "ui/open-link" &&
    hasOnlyKeys(value.params, openLinkParamKeys) &&
    typeof value.params.url === "string"
  ) {
    return {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId,
      callId,
      capability: "ui/open-link",
      params: { url: value.params.url },
    }
  }

  if (
    value.capability === "ui/update-model-context" &&
    hasOnlyKeys(value.params, updateModelContextParamKeys) &&
    (value.params.content === undefined || typeof value.params.content === "string")
  ) {
    const structuredContent =
      value.params.structuredContent === undefined
        ? undefined
        : parseSnapshotValue(value.params.structuredContent)
    if (structuredContent !== undefined && !isRecord(structuredContent)) return undefined
    if (value.params.structuredContent !== undefined && structuredContent === undefined) {
      return undefined
    }
    return {
      channel: protocolChannel,
      type: "capability_call",
      surfaceId,
      callId,
      capability: "ui/update-model-context",
      params: {
        ...(value.params.content === undefined ? {} : { content: value.params.content }),
        ...(structuredContent === undefined ? {} : { structuredContent }),
      },
    }
  }

  return undefined
}

const parseSubscriptionMessage = (
  value: Readonly<Record<string, unknown>>,
): SubscriptionSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  const documentId = boundedString(value.documentId, maxIdentifierLength)
  const subscriptionId = boundedString(value.subscriptionId, maxIdentifierLength)
  if (
    surfaceId === undefined ||
    surfaceId.length === 0 ||
    documentId === undefined ||
    documentId.length === 0 ||
    subscriptionId === undefined ||
    subscriptionId.length === 0 ||
    !subscriptionId.startsWith(`${documentId}:`)
  ) {
    return undefined
  }

  if (value.type === "subscription_start") {
    if (
      !hasOnlyKeys(value, subscriptionStartKeys) ||
      Object.keys(value).length !== subscriptionStartKeys.size ||
      typeof value.subscription !== "string" ||
      value.subscription.length === 0 ||
      value.subscription.length > maxIdentifierLength ||
      !isValidSubscriptionName(value.subscription) ||
      !Object.hasOwn(value, "input")
    ) {
      return undefined
    }
    const input = parseSnapshotValue(value.input)
    return input === undefined
      ? undefined
      : {
          channel: protocolChannel,
          type: "subscription_start",
          surfaceId,
          documentId,
          subscriptionId,
          subscription: value.subscription,
          input,
        }
  }

  if (value.type === "subscription_ack") {
    if (
      !hasOnlyKeys(value, subscriptionAckKeys) ||
      Object.keys(value).length !== subscriptionAckKeys.size ||
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence <= 0
    ) {
      return undefined
    }
    return {
      channel: protocolChannel,
      type: "subscription_ack",
      surfaceId,
      documentId,
      subscriptionId,
      sequence: value.sequence,
    }
  }

  if (value.type === "subscription_unsubscribe") {
    return !hasOnlyKeys(value, subscriptionUnsubscribeKeys) ||
      Object.keys(value).length !== subscriptionUnsubscribeKeys.size
      ? undefined
      : {
          channel: protocolChannel,
          type: "subscription_unsubscribe",
          surfaceId,
          documentId,
          subscriptionId,
        }
  }

  if (value.type !== "subscription_cancel") return undefined
  if (
    !hasOnlyKeys(value, subscriptionCancelKeys) ||
    Object.keys(value).length !== subscriptionCancelKeys.size ||
    (value.reason !== "handler_failed" && value.reason !== "overflow")
  ) {
    return undefined
  }
  return {
    channel: protocolChannel,
    type: "subscription_cancel",
    surfaceId,
    documentId,
    subscriptionId,
    reason: value.reason,
  }
}

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
  if (
    surfaceId === undefined ||
    !hasOnlyKeys(value, resizeMessageKeys) ||
    !Object.hasOwn(value, "channel") ||
    !Object.hasOwn(value, "type") ||
    !Object.hasOwn(value, "surfaceId") ||
    !Object.hasOwn(value, "width") ||
    !Object.hasOwn(value, "height")
  ) {
    return undefined
  }
  if (
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    value.width < 0 ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.height) ||
    value.height < 0
  ) {
    return undefined
  }
  return {
    channel: protocolChannel,
    type: "resize",
    surfaceId,
    width: Math.max(0, Math.ceil(value.width)),
    height: Math.max(0, Math.ceil(value.height)),
  }
}

const parseHeartbeatMessage = (
  value: Readonly<Record<string, unknown>>,
): HeartbeatSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  return surfaceId === undefined
    ? undefined
    : { channel: protocolChannel, type: "heartbeat", surfaceId }
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

const parseSnapshotMessage = (
  value: Readonly<Record<string, unknown>>,
): SnapshotSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  const requestId = boundedString(value.requestId, maxIdentifierLength)
  if (surfaceId === undefined || requestId === undefined) return undefined
  if (value.ok === false) {
    return { channel: protocolChannel, type: "snapshot", surfaceId, requestId, ok: false }
  }
  if (value.ok !== true || !Object.hasOwn(value, "value")) return undefined
  const snapshot = parseSnapshotValue(value.value)
  return snapshot === undefined
    ? undefined
    : {
        channel: protocolChannel,
        type: "snapshot",
        surfaceId,
        requestId,
        ok: true,
        value: snapshot,
      }
}

const parseTeardownMessage = (
  value: Readonly<Record<string, unknown>>,
): TeardownSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxIdentifierLength)
  const requestId = boundedString(value.requestId, maxIdentifierLength)
  if (surfaceId === undefined || requestId === undefined) return undefined
  if (value.ok === false) {
    return hasOnlyKeys(value, teardownFailureKeys)
      ? { channel: protocolChannel, type: "teardown", surfaceId, requestId, ok: false }
      : undefined
  }
  if (value.ok !== true || !hasOnlyKeys(value, teardownSuccessKeys)) return undefined
  if (!Object.hasOwn(value, "value")) {
    return { channel: protocolChannel, type: "teardown", surfaceId, requestId, ok: true }
  }
  const snapshot = parseSnapshotValue(value.value)
  return snapshot === undefined
    ? undefined
    : {
        channel: protocolChannel,
        type: "teardown",
        surfaceId,
        requestId,
        ok: true,
        value: snapshot,
      }
}

export const parseSandboxMessage = (value: unknown): ParseSandboxMessageResult => {
  if (!isRecord(value)) return { ok: false, reason: "bad_message" }
  if (value.channel !== protocolChannel) return { ok: false, reason: "unknown_channel" }

  const message =
    value.type === undefined
      ? parseActionMessage(value)
      : value.type === "heartbeat"
        ? parseHeartbeatMessage(value)
        : value.type === "resize"
          ? parseResizeMessage(value)
          : value.type === "guest_error"
            ? parseGuestErrorMessage(value)
            : value.type === "snapshot"
              ? parseSnapshotMessage(value)
              : value.type === "teardown"
                ? parseTeardownMessage(value)
                : value.type === "capability_call"
                  ? parseCapabilityMessage(value)
                  : value.type === "subscription_start" ||
                      value.type === "subscription_ack" ||
                      value.type === "subscription_unsubscribe" ||
                      value.type === "subscription_cancel"
                    ? parseSubscriptionMessage(value)
                    : undefined
  return message === undefined ? { ok: false, reason: "bad_message" } : { ok: true, value: message }
}
