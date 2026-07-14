import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const { build: buildBrowserFixture } = createRequire(
  new URL("../packages/genui/package.json", import.meta.url),
)("esbuild")

const run = async (command, args, cwd) => {
  try {
    return await execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1_024 * 1_024,
    })
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
  }
}

const packPackage = async (name, directory, destination) => {
  const { stdout } = await run(
    "nub",
    ["pack", "--pack-destination", destination, "--json"],
    join(root, directory),
  )
  const [metadata] = JSON.parse(stdout)
  assert(metadata)
  assert.equal(metadata.name, name)
  assert(
    metadata.files.every(({ path }) => {
      const isPackageMetadata =
        path === "package.json" || /^(?:readme|licen[cs]e)(?:\.|$)/i.test(path)
      return isPackageMetadata || path.startsWith("dist/")
    }),
  )
  return { ...metadata, size: (await stat(metadata.filename)).size }
}

const temp = await mkdtemp(join(tmpdir(), "genui-pack-smoke-"))

try {
  const packs = join(temp, "packs")
  const project = join(temp, "project")
  const checkerProject = join(temp, "checker-project")
  await mkdir(packs)
  await mkdir(project)
  await mkdir(checkerProject)

  await run("nub", ["run", "build"], root)
  const genuiPack = await packPackage("genui", "packages/genui", packs)
  const checkerPack = await packPackage("@genui/check", "packages/check", packs)

  await writeFile(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "genui-pack-smoke",
        private: true,
        type: "module",
        dependencies: {
          genui: `file:${genuiPack.filename}`,
          zod: "4.4.3",
        },
      },
      null,
      2,
    )}\n`,
  )

  await writeFile(
    join(project, "smoke.mjs"),
    `import assert from "node:assert/strict"
import { action, Genui, memoryStore, subscription } from "genui"
import { mount, SubscriptionTransportError } from "genui/dom"
import {
  codeDialect,
  parseActionCall,
  parseSubscriptionDelivery,
  parseSubscriptionRequest,
  parseSurface,
} from "genui/protocol"
import { assertSurfaceStoreConformance } from "genui/testing"

assert.equal(typeof Genui, "function")
assert.equal(typeof action, "function")
assert.equal(typeof memoryStore, "function")
assert.equal(typeof subscription, "function")
assert.equal(typeof mount, "function")
assert.equal(typeof SubscriptionTransportError, "function")
assert.equal(typeof parseActionCall, "function")
assert.equal(typeof parseSubscriptionRequest, "function")
assert.equal(typeof parseSubscriptionDelivery, "function")
assert.equal(typeof assertSurfaceStoreConformance, "function")
assert.equal(codeDialect, "code/0")

const assertPackageMissing = async (specifier) => {
  await assert.rejects(import(specifier), (error) => error?.code === "ERR_MODULE_NOT_FOUND")
}
await assertPackageMissing("@genui/check")
await assertPackageMissing("parse5")
await assertPackageMissing("typescript")

const updates = subscription({
  name: "pack.events",
  description: "Emit one pack-smoke event.",
  input: {
    "~standard": {
      version: 1,
      vendor: "pack-smoke",
      validate: () => ({ value: {} }),
      jsonSchema: {
        input: () => ({ type: "object", additionalProperties: false }),
        output: () => ({ type: "object", additionalProperties: false }),
      },
    },
  },
  event: {
    "~standard": {
      version: 1,
      vendor: "pack-smoke",
      validate: (value) =>
        typeof value === "object" && value !== null && value.message === "ready"
          ? { value: { message: "ready" } }
          : { issues: [{ message: "Expected the ready event." }] },
      jsonSchema: {
        input: () => ({ type: "object" }),
        output: () => ({
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        }),
      },
    },
  },
  async *subscribe(_context, _input, { signal }) {
    if (!signal.aborted) yield { message: "ready" }
  },
})
const readTopic = action({
  name: "pack.read_topic",
  description: "Read one pack-smoke topic.",
  effect: "read",
  input: {
    "~standard": {
      version: 1,
      vendor: "pack-smoke",
      validate: () => ({ value: {} }),
    },
  },
  inputJsonSchema: { type: "object" },
  output: {
    "~standard": {
      version: 1,
      vendor: "pack-smoke",
      validate: (value) => ({ value }),
      jsonSchema: {
        input: () => ({ type: "object" }),
        output: () => ({
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        }),
      },
    },
  },
  execute: () => ({ message: "ready" }),
})
const genui = new Genui({ actions: [readTopic], subscriptions: [updates], store: memoryStore() })
const generation = genui.generation({ actions: [readTopic], subscriptions: [updates] })
const guidance = generation.guidance()
assert.match(guidance.environment, /genui.call/)
assert.match(guidance.capabilityContract, /pack.read_topic/)
const surface = await generation.createSurface({ content: "<p>pack smoke</p>" })
assert.equal(parseSurface(JSON.parse(JSON.stringify(surface)))?.id, surface.id)
assert.deepEqual(surface.grant.actions[0]?.inputSchema, { type: "object" })
assert.deepEqual(surface.grant.actions[0]?.outputSchema, {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
})
assert.equal(surface.grant.subscriptions[0]?.name, updates.name)
assert.deepEqual(surface.grant.subscriptions[0]?.inputSchema, {
  type: "object",
  additionalProperties: false,
})
assert.deepEqual(surface.grant.subscriptions[0]?.eventSchema, {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
})
assert.equal(
  parseActionCall({
    surfaceId: surface.id,
    callId: "pack-smoke",
    action: "smoke.read",
    input: {},
  })?.action,
  "smoke.read",
)

const request = parseSubscriptionRequest({
  surfaceId: surface.id,
  subscriptionId: "pack-subscription",
  subscription: updates.name,
  input: {},
})
assert(request)
const opened = await genui.subscribe(request, undefined)
assert.equal(opened.ok, true)
assert(opened.ok)
const events = opened.events[Symbol.asyncIterator]()
const next = await events.next()
assert.equal(next.done, false)
const delivery = parseSubscriptionDelivery(JSON.parse(JSON.stringify(next.value)))
assert.equal(delivery?.type, "event")
assert.equal(delivery?.sequence, 1)
assert.deepEqual(delivery?.type === "event" ? delivery.event : undefined, { message: "ready" })
assert.equal((await events.next()).done, true)
`,
  )

  await writeFile(
    join(project, "smoke.ts"),
    `import { z } from "zod"
import {
  Genui,
  action,
  memoryStore,
  subscription,
  type ActionDefinition,
  type CreateSurfaceOptions,
  type Generation,
  type GenerationGuidance,
  type GenerationOptions,
  type GenuiOptions,
  type StandardJSONSchemaV1,
  type StandardSchemaV1,
  type SubscriptionDefinition,
  type SurfaceStore,
  type SurfaceStoreIdempotencyRequest,
  type SurfaceStoreIdempotencyResult,
} from "genui"
import {
  mount,
  SubscriptionTransportError,
  type ActionConfirmationHandler,
  type ActionTransport,
  type ActionTransportOptions,
  type SubscriptionCloseReason as BrowserSubscriptionCloseReason,
  type ContainerDimensions,
  type HostContext,
  type ImagePolicy,
  type MountOptions,
  type Mounted,
  type ReplaceOptions,
  type SnapshotValue,
  type SubscriptionTransport,
  type SurfaceViolationReason,
  type TeardownOptions,
} from "genui/dom"
import {
  parseActionCall,
  parseSubscriptionDelivery,
  parseSubscriptionRequest,
  parseSurface,
  type ActionCall,
  type ActionResult,
  type SubscriptionDelivery,
  type SubscriptionRequest,
  type Surface,
  type SurfaceRecord,
} from "genui/protocol"
import { assertSurfaceStoreConformance, type SurfaceStoreFactory } from "genui/testing"

interface PackContext {
  readonly prefix: string
}

const topicSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "pack-smoke",
    validate: (_value: unknown) => ({ value: { topic: "all" } }),
    jsonSchema: {
      input: (_options: { readonly target: string }) => ({
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      }),
      output: (_options: { readonly target: string }) => ({ type: "object" }),
    },
  },
}
const messageSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "pack-smoke",
    validate: (_value: unknown) => ({ value: { message: "ready" } }),
    jsonSchema: {
      input: (_options: { readonly target: string }) => ({ type: "object" }),
      output: (_options: { readonly target: string }) => ({
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      }),
    },
  },
}
const runtimeTopicSchema: StandardSchemaV1<unknown, { readonly topic: string }> = topicSchema
const modelTopicSchema: StandardJSONSchemaV1<unknown, { readonly topic: string }> = topicSchema
const manualTopicSchema: StandardSchemaV1<unknown, { readonly topic: string }> = {
  "~standard": {
    version: 1,
    vendor: "pack-smoke",
    validate: (_value) => ({ value: { topic: "all" } }),
  },
}
const dateInputSchema = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (value) => value.toISOString(),
})
const yearOutputSchema = z.codec(z.number(), z.string(), {
  decode: (value) => String(value),
  encode: (value) => Number(value),
})

const readTopic = action({
  name: "pack.read_topic",
  description: "Read one pack-smoke topic.",
  effect: "read",
  input: manualTopicSchema,
  inputJsonSchema: {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
  },
  output: messageSchema,
  execute: (context: PackContext, input) => ({ message: context.prefix + input.topic }),
})
const actionDefinition: ActionDefinition<
  PackContext,
  { readonly topic: string },
  { readonly message: string }
> = readTopic
const projectedOutputSchema = new Genui({ actions: [readTopic] }).actions()[0]?.outputSchema

const readYear = action({
  name: "pack.read_year",
  description: "Read the UTC year from an ISO date.",
  effect: "read",
  input: dateInputSchema,
  output: yearOutputSchema,
  execute: (_context: PackContext, input) => {
    const canonicalInput: Date = input
    // @ts-expect-error The handler receives the validator's canonical Date output.
    const guestInput: string = input
    void guestInput
    return canonicalInput.getUTCFullYear()
  },
})
const transformingActionDefinition: ActionDefinition<
  PackContext,
  Date,
  string,
  string,
  number
> = readYear

const invalidTransformingOutput = action(
  // @ts-expect-error The output validator accepts a number from the handler.
  {
    name: "pack.invalid_transforming_output",
    description: "Reject an incompatible handler output candidate.",
    effect: "read",
    input: dateInputSchema,
    output: yearOutputSchema,
    execute: (_context: PackContext, _input) => "wrong candidate",
  },
)

const invalidOutputContract = action(
  // @ts-expect-error output JSON Schema requires a runtime output validator.
  {
    name: "pack.invalid_output",
    description: "Invalid compile-time contract fixture.",
    effect: "read",
    input: topicSchema,
    outputJsonSchema: { type: "object" },
    execute: (_context: PackContext, input) => ({ message: input.topic }),
  },
)

const updates = subscription({
  name: "pack.events",
  description: "Emit pack-smoke events.",
  input: topicSchema,
  event: messageSchema,
  async *subscribe(context: PackContext, input, { signal }) {
    if (!signal.aborted) yield { message: context.prefix + input.topic }
  },
})
const subscriptionDefinition: SubscriptionDefinition<
  PackContext,
  { readonly topic: string },
  { readonly message: string }
> = updates

class PackSurfaceStore implements SurfaceStore {
  readonly #backing = memoryStore()

  get(id: string): Promise<SurfaceRecord | undefined> {
    return Promise.resolve(this.#backing.get(id))
  }

  set(record: SurfaceRecord): Promise<void> {
    return Promise.resolve(this.#backing.set(record))
  }

  revoke(id: string): Promise<void> {
    return Promise.resolve(this.#backing.revoke(id))
  }

  runIdempotent(
    request: SurfaceStoreIdempotencyRequest,
    operation: () => Promise<ActionResult>,
  ): Promise<SurfaceStoreIdempotencyResult> {
    return Promise.resolve(this.#backing.runIdempotent(request, operation))
  }
}

const genuiOptions: GenuiOptions<PackContext> = {
  actions: [readTopic],
  subscriptions: [updates],
  store: new PackSurfaceStore(),
}
const genui = new Genui(genuiOptions)
const generationOptions: GenerationOptions<PackContext> = {
  actions: [readTopic],
  subscriptions: [updates],
}
const generation: Generation = genui.generation(generationOptions)
const generationGuidance: GenerationGuidance = generation.guidance()
const createSurfaceOptions: CreateSurfaceOptions = {
  content: "<p>pack type smoke</p>",
  subject: "pack-subject",
}
const generatedSurface: Promise<Surface> = generation.createSurface(createSurfaceOptions)
const call: ActionCall = {
  surfaceId: "surface",
  callId: "call",
  action: "smoke.read",
  input: {},
}
const parsedCall: ActionCall | undefined = parseActionCall(call)
const subscriptionRequest: SubscriptionRequest = {
  surfaceId: "surface",
  subscriptionId: "subscription",
  subscription: "pack.events",
  input: { topic: "all" },
}
const parsedSubscriptionRequest: SubscriptionRequest | undefined =
  parseSubscriptionRequest(subscriptionRequest)
const subscriptionDelivery: SubscriptionDelivery = {
  type: "event",
  surfaceId: "surface",
  subscriptionId: "subscription",
  sequence: 1,
  event: { message: "ready" },
}
const parsedSubscriptionDelivery: SubscriptionDelivery | undefined =
  parseSubscriptionDelivery(subscriptionDelivery)
const actionTransport: ActionTransport = async (_call, { signal }) =>
  signal.aborted ? { ok: false } : { ok: true, value: null }
const actionTransportOptions: ActionTransportOptions = {
  signal: new AbortController().signal,
}
const confirmAction: ActionConfirmationHandler = async (_action, _call, intent) =>
  intent.length > 0
const subscriptionTransport: SubscriptionTransport = async (_request, { signal }) => ({
  events: (async function* () {
    if (!signal.aborted) yield subscriptionDelivery
  })(),
})
const subscriptionTransportError = new SubscriptionTransportError(
  "not_available",
  "Subscription transport is unavailable.",
)
const parsedSurface: Surface | undefined = parseSurface({})
const mountFunction: typeof mount = mount
const snapshot: SnapshotValue = { selected: "pack" }
const imagePolicy: ImagePolicy = "none"
const mountOptions: MountOptions = {
  transport: actionTransport,
  subscriptionTransport,
  confirm: confirmAction,
  imagePolicy,
  snapshot,
}
const replaceOptions: ReplaceOptions = { snapshot }
const teardownOptions: TeardownOptions = { reason: "pack-smoke", timeoutMs: 1_000 }
const violationReason: SurfaceViolationReason = "bad_message"
const closeReason: BrowserSubscriptionCloseReason = "completed"
const mounted: Mounted | undefined = undefined
const unboundedDimensions: ContainerDimensions = {}
const constrainedDimensions: ContainerDimensions = { width: 400, maxHeight: 720 }
const hostContext: HostContext = {
  containerDimensions: constrainedDimensions,
  locale: "en-US",
  timeZone: "UTC",
  platform: "web",
}
const storeFactory: SurfaceStoreFactory = memoryStore
const conformanceCheck: typeof assertSurfaceStoreConformance = assertSurfaceStoreConformance
const resultOutcome = (result: ActionResult): string =>
  result.ok ? "ok" : result.error.code

void genui
void generationGuidance
void generatedSurface
void actionDefinition
void transformingActionDefinition
void invalidTransformingOutput
void runtimeTopicSchema
void modelTopicSchema
void projectedOutputSchema
void invalidOutputContract
void subscriptionDefinition
void parsedCall
void parsedSubscriptionRequest
void parsedSubscriptionDelivery
void subscriptionTransportError
void parsedSurface
void mountFunction
void actionTransportOptions
void mountOptions
void replaceOptions
void teardownOptions
void violationReason
void closeReason
void mounted
void unboundedDimensions
void hostContext
void storeFactory
void conformanceCheck
void resultOutcome
`,
  )

  await writeFile(
    join(project, "browser.mjs"),
    `import { Genui } from "genui"
import { mount } from "genui/dom"
import { parseSurface } from "genui/protocol"

void Genui
void mount
void parseSurface
`,
  )

  await writeFile(
    join(project, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: ["smoke.ts"],
      },
      null,
      2,
    )}\n`,
  )

  await writeFile(
    join(checkerProject, "package.json"),
    `${JSON.stringify(
      {
        name: "genui-check-pack-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@genui/check": `file:${checkerPack.filename}`,
          genui: `file:${genuiPack.filename}`,
        },
      },
      null,
      2,
    )}\n`,
  )

  await writeFile(
    join(checkerProject, "smoke.mjs"),
    `import assert from "node:assert/strict"
import { checkGeneratedInterface } from "@genui/check"
import { action, Genui } from "genui"

const input = {
  "~standard": {
    version: 1,
    vendor: "check-pack-smoke",
    validate: (value) =>
      typeof value === "object" && value !== null && typeof value.query === "string"
        ? { value: { query: value.query } }
        : { issues: [{ message: "query required" }] },
  },
}
const search = action({
  name: "pack.search",
  description: "Search the pack-smoke fixture.",
  effect: "read",
  input,
  inputJsonSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  execute: (_context, value) => ({ query: value.query }),
})
const generation = new Genui({ actions: [search] }).generation({ actions: [search] })

const valid = await checkGeneratedInterface(generation, {
  content: '<script type="module">await genui.call("pack.search", { query: "GenUI" })</script>',
})
assert.deepEqual(valid, { ok: true })

const invalid = await checkGeneratedInterface(generation, {
  content: '<script type="module">genui.missing()</script>',
})
assert.equal(invalid.ok, false)
assert.match(invalid.report, /missing/)
`,
  )

  await writeFile(
    join(checkerProject, "smoke.ts"),
    `import {
  checkGeneratedInterface,
  type CheckGeneratedInterfaceOptions,
  type GeneratedInterfaceCheckResult,
  type GeneratedInterfaceDiagnostic,
} from "@genui/check"
import {
  Genui,
  action,
  generationCheckerContractVersion,
  readGenerationCheckerContract,
  type Generation,
  type GenerationCheckerCapabilityInput,
  type GenerationCheckerContract,
  type StandardSchemaV1,
} from "genui"

const input: StandardSchemaV1<unknown, { readonly query: string }> = {
  "~standard": {
    version: 1,
    vendor: "check-pack-smoke",
    validate: (_value) => ({ value: { query: "GenUI" } }),
  },
}
const search = action({
  name: "pack.search",
  description: "Search the pack-smoke fixture.",
  effect: "read",
  input,
  inputJsonSchema: { type: "object" },
  execute: (_context: undefined, value) => value,
})
const generation: Generation = new Genui({ actions: [search] }).generation({ actions: [search] })
const contract: GenerationCheckerContract | undefined = readGenerationCheckerContract(generation)
const contractVersion: 1 = generationCheckerContractVersion
const capabilityInput: GenerationCheckerCapabilityInput | undefined =
  contract?.capabilityInputs[0]
const options: CheckGeneratedInterfaceOptions = {
  content: '<script type="module">await genui.call("pack.search", {})</script>',
}
const checked: Promise<GeneratedInterfaceCheckResult> = checkGeneratedInterface(
  generation,
  options,
)
const diagnostic: GeneratedInterfaceDiagnostic = {
  code: "TS2339",
  line: 1,
  column: 1,
  message: "Example external-consumer diagnostic.",
}
const report = (result: GeneratedInterfaceCheckResult): string | undefined =>
  result.ok ? undefined : result.report

void contractVersion
void capabilityInput
void checked
void diagnostic
void report
`,
  )

  await writeFile(
    join(checkerProject, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: ["smoke.ts"],
      },
      null,
      2,
    )}\n`,
  )

  await run("nub", ["install", "--ignore-scripts"], project)
  await run("node", ["smoke.mjs"], project)
  await run(
    "node",
    [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    project,
  )

  const browserBuild = await buildBrowserFixture({
    absWorkingDir: project,
    bundle: true,
    entryPoints: ["browser.mjs"],
    format: "esm",
    metafile: true,
    outfile: "browser.js",
    platform: "browser",
  })
  assert.doesNotMatch(
    Object.keys(browserBuild.metafile.inputs).join("\n"),
    /(?:@genui\/check|parse5|typescript)/,
  )

  await run("nub", ["install", "--ignore-scripts"], checkerProject)
  await run("node", ["smoke.mjs"], checkerProject)
  await run(
    "node",
    [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    checkerProject,
  )

  process.stdout.write(
    `PACKAGE-ISOLATION-001 passed. genui package: ${String(genuiPack.size)} bytes; @genui/check package: ${String(checkerPack.size)} bytes.\n`,
  )
} finally {
  await rm(temp, { force: true, recursive: true })
}
