import { genui0Dialect } from "../dialect/genui0.js"
import { genui0Language } from "../dialect/genui0-language.js"
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

installSandboxRuntime(
  config,
  genui0Language,
  genui0Dialect.runtime,
  sandboxGlobal as unknown as SandboxRuntimeGlobal,
)
