import { protocolChannel } from "./protocol.js"
import { sandboxRuntimeAsset } from "./sandbox-asset.generated.js"

const serializedConfig = (surfaceId: string): string =>
  JSON.stringify({ channel: protocolChannel, surfaceId }).replaceAll("</script", "<\\/script")

/** Build the sandbox-side runtime asset injected into a generated surface document. */
export const sandboxBridgeScript = (surfaceId: string): string => `
(() => {
  globalThis.__genuiSandboxConfig = ${serializedConfig(surfaceId)};
  ${sandboxRuntimeAsset}
})();
`
