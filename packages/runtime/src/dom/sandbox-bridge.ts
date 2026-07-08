import { genui0SandboxLanguageScript } from "../dialect/genui0-language.js"
import { protocolChannel } from "./protocol.js"
import { installSandboxRuntime } from "./sandbox-runtime.js"

const escapeScriptJson = (value: string): string =>
  JSON.stringify(value).replaceAll("</script", "<\\/script")

const runtimeSource = (): string => installSandboxRuntime.toString()

/** Build the sandbox-side runtime asset injected into a generated surface document. */
export const sandboxBridgeScript = (surfaceId: string): string => `
(() => {
  ${genui0SandboxLanguageScript()}
  const language = {
    invalid: genui0Invalid,
    parseObjectLiteral: genui0ParseObjectLiteral,
    evaluateExpression: genui0EvaluateExpression,
    parseCapabilityExpression: parseGenui0CapabilityExpression,
    defaultResultTarget: genui0DefaultResultTarget,
  };

  (${runtimeSource()})(
    { channel: ${escapeScriptJson(protocolChannel)}, surfaceId: ${escapeScriptJson(surfaceId)} },
    language,
    globalThis
  );
})();
`
