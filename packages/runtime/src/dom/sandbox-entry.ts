import {
  installSandboxRuntime,
  type SandboxRuntimeConfig,
  type SandboxRuntimeGlobal,
} from "./sandbox-runtime.js"

type SandboxEntryGlobal = typeof globalThis & {
  __genuiSandboxConfig?: SandboxRuntimeConfig
}

const sandboxGlobal = globalThis as SandboxEntryGlobal
const config = sandboxGlobal.__genuiSandboxConfig
delete sandboxGlobal.__genuiSandboxConfig

if (config === undefined) {
  throw new Error("Missing GenUI sandbox config.")
}

installSandboxRuntime(config, sandboxGlobal as unknown as SandboxRuntimeGlobal)
