/** Parameters delivered when a surface asks the host to send a conversation message. */
export interface SendMessageParams {
  readonly role: "user"
  readonly content: {
    readonly type: "text"
    readonly text: string
  }
}

/** Parameters delivered when a surface asks the host to open an external link. */
export interface OpenLinkParams {
  readonly url: string
}

/** Parameters delivered when a surface updates its context for future model turns. */
export interface UpdateModelContextParams {
  readonly content?: string
  readonly structuredContent?: Readonly<Record<string, unknown>>
}

/** Optional host functions made available to generated surfaces. */
export interface HostCapabilities {
  readonly sendMessage?: (params: SendMessageParams) => Promise<void>
  readonly openLink?: (params: OpenLinkParams) => Promise<void>
  readonly updateModelContext?: (params: UpdateModelContextParams) => Promise<void>
}

export type HostCapabilityName = keyof HostCapabilities

/** Observable terminal state of a host capability request. */
export type HostCapabilityOutcome =
  | "ok"
  | "not_available"
  | "denied"
  | "invalid_input"
  | "rate_limited"
  | "superseded"

/** Capability availability exposed to generated code. */
export type HostCapabilityFlags = Readonly<Record<HostCapabilityName, boolean>>
