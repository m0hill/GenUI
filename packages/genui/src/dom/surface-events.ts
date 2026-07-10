import type { ActionCall, ActionResult, SubscriptionErrorCode } from "../protocol/index.js"
import type { HostCapabilityName, HostCapabilityOutcome } from "./host-capabilities.js"

export type SurfaceViolationReason =
  | "bad_message"
  | "ungranted_call"
  | "ungranted_subscription"
  | "navigation"
  | "unresponsive"
  | "snapshot_timeout"
  | "teardown_timeout"

export type SubscriptionCloseReason =
  | "completed"
  | "unsubscribed"
  | "replaced"
  | "disposed"
  | "terminated"
  | SubscriptionErrorCode

export type SurfaceEvent =
  | { readonly type: "call"; readonly call: ActionCall }
  | {
      readonly type: "result"
      readonly callId: string
      readonly action: string
      readonly result: ActionResult
    }
  | {
      readonly type: "capability_call"
      readonly call: {
        readonly surfaceId: string
        readonly callId: string
        readonly capability: HostCapabilityName
      }
      readonly payloadBytes: number
    }
  | {
      readonly type: "capability_result"
      readonly callId: string
      readonly capability: HostCapabilityName
      readonly outcome: HostCapabilityOutcome
    }
  | {
      readonly type: "subscription_start"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subscription: string
      readonly inputBytes: number
    }
  | {
      readonly type: "subscription_opened"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subscription: string
    }
  | {
      readonly type: "subscription_event"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subscription: string
      readonly sequence: number
      readonly payloadBytes: number
    }
  | {
      readonly type: "subscription_closed"
      readonly surfaceId: string
      readonly subscriptionId: string
      readonly subscription: string
      readonly reason: SubscriptionCloseReason
      readonly eventCount: number
      readonly payloadBytes: number
      readonly durationMs: number
    }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "guest_error"; readonly message: string; readonly stack?: string }
  | {
      readonly type: "violation"
      readonly reason: SurfaceViolationReason
      readonly detail?: string
    }
