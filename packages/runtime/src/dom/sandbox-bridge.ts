import { protocolChannel } from "./protocol.js"
import { sandboxRuntimeAsset } from "./sandbox-asset.generated.js"
import type { SurfaceSnapshot } from "./protocol.js"

const serializedConfig = (surfaceId: string, snapshot?: SurfaceSnapshot): string =>
  JSON.stringify({
    channel: protocolChannel,
    surfaceId,
    ...(snapshot === undefined ? {} : { snapshot }),
  }).replaceAll("</script", "<\\/script")

/** Build the sandbox-side runtime asset injected into a generated surface document. */
export const sandboxBridgeScript = (surfaceId: string, snapshot?: SurfaceSnapshot): string => `
(() => {
  globalThis.__genuiSandboxConfig = ${serializedConfig(surfaceId, snapshot)};
  ${sandboxRuntimeAsset}
})();
`
