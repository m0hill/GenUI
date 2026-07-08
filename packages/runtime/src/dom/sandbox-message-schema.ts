import { isRecord } from "../record.js"
import type { ActionCall } from "../types.js"
import { protocolChannel, type SurfaceSnapshot } from "./protocol.js"

export interface ActionSandboxMessage extends ActionCall {
  readonly channel: typeof protocolChannel
  readonly type: "capability"
  readonly target?: string
}

interface ResizeSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "resize"
  readonly surfaceId: string
  readonly height: number
}

interface LinkSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "link"
  readonly surfaceId: string
  readonly href: string
}

interface ViolationSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "violation"
  readonly surfaceId: string
  readonly reason: "runtime_expression"
  readonly detail?: string
}

export interface SnapshotSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "snapshot"
  readonly surfaceId: string
  readonly requestId: string
  readonly snapshot: SurfaceSnapshot
}

export type SandboxMessage =
  | ActionSandboxMessage
  | ResizeSandboxMessage
  | LinkSandboxMessage
  | ViolationSandboxMessage

export type ParseSandboxMessageResult =
  | { readonly ok: true; readonly value: SandboxMessage }
  | { readonly ok: false; readonly reason: "unknown_channel" | "bad_message" }

const maxProtocolIdentifierLength = 256
const maxHrefLength = 2_048
const maxViolationDetailLength = 240

const boundedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" && value.length <= maxLength ? value : undefined

const truncatedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string"
    ? value.length <= maxLength
      ? value
      : `${value.slice(0, maxLength - 3)}...`
    : undefined

const parseResizeMessage = (
  value: Readonly<Record<string, unknown>>,
): ResizeSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxProtocolIdentifierLength)
  if (surfaceId === undefined) return undefined
  if (typeof value.height !== "number" || !Number.isFinite(value.height)) return undefined

  return {
    channel: protocolChannel,
    type: "resize",
    surfaceId,
    height: value.height,
  }
}

const parseLinkMessage = (
  value: Readonly<Record<string, unknown>>,
): LinkSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxProtocolIdentifierLength)
  const href = boundedString(value.href, maxHrefLength)
  if (surfaceId === undefined || href === undefined) return undefined

  return {
    channel: protocolChannel,
    type: "link",
    surfaceId,
    href,
  }
}

const parseCapabilityMessage = (
  value: Readonly<Record<string, unknown>>,
): ActionSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxProtocolIdentifierLength)
  const callId = boundedString(value.callId, maxProtocolIdentifierLength)
  const action = typeof value.action === "string" ? value.action : value.capability
  const actionName = boundedString(action, maxProtocolIdentifierLength)
  const target =
    value.target === undefined
      ? undefined
      : boundedString(value.target, maxProtocolIdentifierLength)
  if (surfaceId === undefined || callId === undefined || actionName === undefined) {
    return undefined
  }
  if (value.target !== undefined && target === undefined) return undefined

  return {
    channel: protocolChannel,
    type: "capability",
    surfaceId,
    callId,
    action: actionName,
    input: value.input,
    ...(target === undefined ? {} : { target }),
  }
}

const parseViolationMessage = (
  value: Readonly<Record<string, unknown>>,
): ViolationSandboxMessage | undefined => {
  const surfaceId = boundedString(value.surfaceId, maxProtocolIdentifierLength)
  if (surfaceId === undefined) return undefined
  if (value.reason !== "runtime_expression") return undefined
  const detail =
    value.detail === undefined ? undefined : truncatedString(value.detail, maxViolationDetailLength)
  if (value.detail !== undefined && detail === undefined) return undefined

  return {
    channel: protocolChannel,
    type: "violation",
    surfaceId,
    reason: value.reason,
    ...(detail === undefined ? {} : { detail }),
  }
}

const parseSnapshot = (value: unknown): SurfaceSnapshot | undefined => {
  if (!isRecord(value)) return undefined

  const rowStates: Record<string, Record<string, Record<string, unknown>>> = {}
  if (isRecord(value.rowStates)) {
    for (const [blockId, rows] of Object.entries(value.rowStates)) {
      if (!isRecord(rows)) continue

      const keyedRows: Record<string, Record<string, unknown>> = {}
      for (const [key, row] of Object.entries(rows)) {
        if (isRecord(row)) keyedRows[key] = row
      }
      if (Object.keys(keyedRows).length > 0) rowStates[blockId] = keyedRows
    }
  }

  return {
    state: isRecord(value.state) ? value.state : {},
    rowStates,
  }
}

export const parseSnapshotSandboxMessage = (value: unknown): SnapshotSandboxMessage | undefined => {
  if (!isRecord(value)) return undefined
  if (value.channel !== protocolChannel) return undefined
  if (value.type !== "snapshot") return undefined
  const surfaceId = boundedString(value.surfaceId, maxProtocolIdentifierLength)
  const requestId = boundedString(value.requestId, maxProtocolIdentifierLength)
  if (surfaceId === undefined || requestId === undefined) return undefined

  const snapshot = parseSnapshot(value.snapshot)
  if (snapshot === undefined) return undefined

  return {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId,
    requestId,
    snapshot,
  }
}

export const parseSandboxMessage = (value: unknown): ParseSandboxMessageResult => {
  if (!isRecord(value)) return { ok: false, reason: "bad_message" }
  if (value.channel !== protocolChannel) return { ok: false, reason: "unknown_channel" }

  if (value.type === "resize") {
    const message = parseResizeMessage(value)
    return message === undefined
      ? { ok: false, reason: "bad_message" }
      : { ok: true, value: message }
  }

  if (value.type === "link") {
    const message = parseLinkMessage(value)
    return message === undefined
      ? { ok: false, reason: "bad_message" }
      : { ok: true, value: message }
  }

  if (value.type === "capability") {
    const message = parseCapabilityMessage(value)
    return message === undefined
      ? { ok: false, reason: "bad_message" }
      : { ok: true, value: message }
  }

  if (value.type === "violation") {
    const message = parseViolationMessage(value)
    return message === undefined
      ? { ok: false, reason: "bad_message" }
      : { ok: true, value: message }
  }

  return { ok: false, reason: "bad_message" }
}
