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
    "pnpm",
    ["--filter", name, "pack", "--pack-destination", destination, "--json"],
    root,
  )
  const metadata = JSON.parse(stdout)
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

  await run("pnpm", ["build"], root)
  const protocolTarball = await packPackage("@genui/protocol", packs)
  const runtimeTarball = await packPackage("@genui/genui", packs)

  await writeFile(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "genui-pack-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@genui/genui": `file:${runtimeTarball}`,
          "@genui/protocol": `file:${protocolTarball}`,
        },
      },
      null,
      2,
    )}\n`,
  )

  await writeFile(
    join(project, "smoke.mjs"),
    `import assert from "node:assert/strict"
import { Genui, memoryStore } from "@genui/genui"
import { mount } from "@genui/genui/dom"
import { parseActionCall, parseSurface } from "@genui/protocol"

assert.equal(typeof Genui, "function")
assert.equal(typeof memoryStore, "function")
assert.equal(typeof mount, "function")
assert.equal(typeof parseActionCall, "function")

const genui = new Genui({ actions: [], store: memoryStore() })
const surface = await genui.surface({ content: "<p>pack smoke</p>", actions: [] })
assert.equal(parseSurface(JSON.parse(JSON.stringify(surface)))?.id, surface.id)
assert.equal(
  parseActionCall({
    surfaceId: surface.id,
    callId: "pack-smoke",
    action: "smoke.read",
    input: {},
  })?.action,
  "smoke.read",
)
`,
  )

  await writeFile(
    join(project, "smoke.ts"),
    `import { Genui, memoryStore } from "@genui/genui"
import { mount, type Mounted } from "@genui/genui/dom"
import { parseActionCall, parseSurface, type ActionCall, type Surface } from "@genui/protocol"

const genui = new Genui<undefined>({ actions: [], store: memoryStore() })
const call: ActionCall = {
  surfaceId: "surface",
  callId: "call",
  action: "smoke.read",
  input: {},
}
const parsedCall: ActionCall | undefined = parseActionCall(call)
const parsedSurface: Surface | undefined = parseSurface({})
const mountFunction: typeof mount = mount
const mounted: Mounted | undefined = undefined

void genui
void parsedCall
void parsedSurface
void mountFunction
void mounted
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

  await run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], project)
  await run("node", ["smoke.mjs"], project)
  await run(
    "node",
    [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    project,
  )

  process.stdout.write("Packed package runtime and type smoke test passed.\n")
} finally {
  await rm(temp, { force: true, recursive: true })
}
