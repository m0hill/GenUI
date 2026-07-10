interface HeartbeatTripwireOptions {
  readonly now: () => number
  readonly schedule: (check: () => void, intervalMs: number) => () => void
  readonly onUnresponsive: () => void
}

export interface HeartbeatTripwire {
  heartbeat(): void
  setDocumentVisible(visible: boolean): void
  setIntersecting(intersecting: boolean): void
  reset(): void
  dispose(): void
}

const checkIntervalMs = 1_000
const unresponsiveAfterMs = 6_000

/** Monitor guest liveness only while browser scheduling should be reliable. */
export const createHeartbeatTripwire = ({
  now,
  schedule,
  onUnresponsive,
}: HeartbeatTripwireOptions): HeartbeatTripwire => {
  let lastHeartbeatAt = now()
  let documentVisible = false
  let intersecting = false
  let tripped = false
  let disposed = false

  const monitoring = (): boolean => documentVisible && intersecting
  const check = (): void => {
    if (disposed || tripped || !monitoring()) return
    if (now() - lastHeartbeatAt <= unresponsiveAfterMs) return
    tripped = true
    onUnresponsive()
  }
  const cancelCheck = schedule(check, checkIntervalMs)

  return {
    heartbeat() {
      if (!disposed) lastHeartbeatAt = now()
    },
    setDocumentVisible(visible) {
      const wasMonitoring = monitoring()
      documentVisible = visible
      if (!wasMonitoring && monitoring()) lastHeartbeatAt = now()
    },
    setIntersecting(nextIntersecting) {
      const wasMonitoring = monitoring()
      intersecting = nextIntersecting
      if (!wasMonitoring && monitoring()) lastHeartbeatAt = now()
    },
    reset() {
      if (disposed) return
      tripped = false
      lastHeartbeatAt = now()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelCheck()
    },
  }
}
