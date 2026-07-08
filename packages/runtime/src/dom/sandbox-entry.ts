import { createGenui0Language } from "../dialect/genui0-language.js"
import { genui0Dialect } from "../dialect/genui0.js"
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

const genui0Language = createGenui0Language()

installSandboxRuntime(
  config,
  {
    invalid: genui0Language.invalid,
    parseObjectLiteral: (source, readState) => genui0Language.parseObjectLiteral(source, readState),
    evaluateExpression: (source, readState) => genui0Language.evaluateExpression(source, readState),
    parseCapabilityExpression: (expression, readState) =>
      genui0Language.parseCapabilityExpression(expression, readState),
    parseSetExpression: (expression, readState) =>
      genui0Language.parseSetExpression(expression, readState),
    defaultResultTarget: (capability) => genui0Language.defaultResultTarget(capability),
  },
  genui0Dialect.runtime,
  sandboxGlobal as unknown as SandboxRuntimeGlobal,
)
