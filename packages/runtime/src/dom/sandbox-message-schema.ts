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

export interface SnapshotSandboxMessage {
  readonly channel: typeof protocolChannel
  readonly type: "snapshot"
  readonly surfaceId: string
  readonly requestId: string
  readonly snapshot: SurfaceSnapshot
}

export type SandboxMessage = ActionSandboxMessage | ResizeSandboxMessage | LinkSandboxMessage

export type ParseSandboxMessageResult =
  | { readonly ok: true; readonly value: SandboxMessage }
  | { readonly ok: false; readonly reason: "unknown_channel" | "bad_message" }

const parseResizeMessage = (
  value: Readonly<Record<string, unknown>>,
): ResizeSandboxMessage | undefined => {
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.height !== "number" || !Number.isFinite(value.height)) return undefined

  return {
    channel: protocolChannel,
    type: "resize",
    surfaceId: value.surfaceId,
    height: value.height,
  }
}

const parseLinkMessage = (
  value: Readonly<Record<string, unknown>>,
): LinkSandboxMessage | undefined => {
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.href !== "string") return undefined

  return {
    channel: protocolChannel,
    type: "link",
    surfaceId: value.surfaceId,
    href: value.href,
  }
}

const parseCapabilityMessage = (
  value: Readonly<Record<string, unknown>>,
): ActionSandboxMessage | undefined => {
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.callId !== "string") return undefined
  const action = typeof value.action === "string" ? value.action : value.capability
  if (typeof action !== "string") return undefined
  if (value.target !== undefined && typeof value.target !== "string") return undefined

  return {
    channel: protocolChannel,
    type: "capability",
    surfaceId: value.surfaceId,
    callId: value.callId,
    action,
    input: value.input,
    ...(typeof value.target === "string" ? { target: value.target } : {}),
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
  if (typeof value.surfaceId !== "string") return undefined
  if (typeof value.requestId !== "string") return undefined

  const snapshot = parseSnapshot(value.snapshot)
  if (snapshot === undefined) return undefined

  return {
    channel: protocolChannel,
    type: "snapshot",
    surfaceId: value.surfaceId,
    requestId: value.requestId,
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

  return { ok: false, reason: "bad_message" }
}
