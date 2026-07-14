import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))

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

const packPackage = async (name, destination) => {
  const { stdout } = await run(
    "nub",
    ["pack", "--pack-destination", destination, "--json"],
    join(root, "packages/genui"),
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
  return metadata.filename
}

const temp = await mkdtemp(join(tmpdir(), "genui-pack-smoke-"))

try {
  const packs = join(temp, "packs")
  const project = join(temp, "project")
  await mkdir(packs)
  await mkdir(project)

  await run("nub", ["run", "build"], root)
  const genuiTarball = await packPackage("genui", packs)

  await writeFile(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "genui-pack-smoke",
        private: true,
        type: "module",
        dependencies: {
          genui: `file:${genuiTarball}`,
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

const updates = subscription({
  name: "pack.events",
  description: "Emit one pack-smoke event.",
  input: {
    "~standard": {
      version: 1,
      vendor: "pack-smoke",
      validate: () => ({ value: {} }),
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
    },
  },
  outputJsonSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
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
assert.deepEqual(surface.grant.actions[0]?.outputSchema, readTopic.outputJsonSchema)
assert.equal(surface.grant.subscriptions[0]?.name, updates.name)
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
    `import {
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

const topicSchema: StandardSchemaV1<unknown, { readonly topic: string }> = {
  "~standard": {
    version: 1,
    vendor: "pack-smoke",
    validate: (_value) => ({ value: { topic: "all" } }),
  },
}
const messageSchema: StandardSchemaV1<unknown, { readonly message: string }> = {
  "~standard": {
    version: 1,
    vendor: "pack-smoke",
    validate: (_value) => ({ value: { message: "ready" } }),
  },
}

const readTopic = action({
  name: "pack.read_topic",
  description: "Read one pack-smoke topic.",
  effect: "read",
  input: topicSchema,
  inputJsonSchema: {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
  },
  output: messageSchema,
  outputJsonSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  execute: (context: PackContext, input) => ({ message: context.prefix + input.topic }),
})
const actionDefinition: ActionDefinition<
  PackContext,
  { readonly topic: string },
  { readonly message: string }
> = readTopic
const projectedOutputSchema = new Genui({ actions: [readTopic] }).actions()[0]?.outputSchema

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

  await run("nub", ["install", "--offline", "--ignore-scripts"], project)
  await run("node", ["smoke.mjs"], project)
  await run(
    "node",
    [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    project,
  )

  process.stdout.write("Packed genui package and type smoke test passed.\n")
} finally {
  await rm(temp, { force: true, recursive: true })
}
