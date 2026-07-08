import type { CapabilityErrorCode, CapabilityResult } from "./types.js"

/** Build the standard capability failure envelope used across execution boundaries. */
export const capabilityError = (code: CapabilityErrorCode, message: string): CapabilityResult => ({
  ok: false,
  error: { code, message },
})
