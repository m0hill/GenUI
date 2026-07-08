/** Internal postMessage channel used between a mounted surface iframe and its host. */
export const protocolChannel = "genui/dom/0"

/** JSON-safe state captured from a running sandbox surface. */
export interface SurfaceSnapshot {
  readonly state: Readonly<Record<string, unknown>>
  readonly rowStates: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >
}

export const emptySurfaceSnapshot = (): SurfaceSnapshot => ({
  state: {},
  rowStates: {},
})
