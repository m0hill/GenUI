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
import { Genui, memoryStore, subscription } from "genui"
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
const genui = new Genui({ actions: [], subscriptions: [updates], store: memoryStore() })
const surface = await genui.surface({
  content: "<p>pack smoke</p>",
  actions: [],
  subscriptions: [updates.name],
})
assert.equal(parseSurface(JSON.parse(JSON.stringify(surface)))?.id, surface.id)
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
    `import { Genui, memoryStore, subscription } from "genui"
import {
  mount,
  SubscriptionTransportError,
  type ContainerDimensions,
  type HostContext,
  type Mounted,
  type SubscriptionTransport,
} from "genui/dom"
import {
  parseActionCall,
  parseSubscriptionDelivery,
  parseSubscriptionRequest,
  parseSurface,
  type ActionCall,
  type SubscriptionDelivery,
  type SubscriptionRequest,
  type Surface,
} from "genui/protocol"
import { assertSurfaceStoreConformance, type SurfaceStoreFactory } from "genui/testing"

const updates = subscription({
  name: "pack.events",
  description: "Emit pack-smoke events.",
  input: {
    "~standard": {
      version: 1 as const,
      vendor: "pack-smoke",
      validate: (_value: unknown) => ({ value: { topic: "all" } }),
    },
  },
  event: {
    "~standard": {
      version: 1 as const,
      vendor: "pack-smoke",
      validate: (_value: unknown) => ({ value: { message: "ready" } }),
    },
  },
  async *subscribe(_context: undefined, input, { signal }) {
    if (!signal.aborted) yield { message: input.topic }
  },
})
const genui = new Genui<undefined>({
  actions: [],
  subscriptions: [updates],
  store: memoryStore(),
})
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
const mountOptions: Parameters<typeof mount>[2] = {
  transport: async () => ({ ok: true, value: null }),
  subscriptionTransport,
}
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

void genui
void parsedCall
void parsedSubscriptionRequest
void parsedSubscriptionDelivery
void subscriptionTransportError
void parsedSurface
void mountFunction
void mountOptions
void mounted
void unboundedDimensions
void hostContext
void storeFactory
void conformanceCheck
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
