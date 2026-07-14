import { parseFragment, type DefaultTreeAdapterTypes, type ParserError } from "parse5"
import type { Diagnostic } from "typescript/unstable/async"
import {
  generationCheckerContractVersion,
  readGenerationCheckerContract,
  type Generation,
  type GenerationCheckerContract,
} from "genui"

export interface CheckGeneratedInterfaceOptions {
  readonly content: string
  readonly signal?: AbortSignal
}

export interface GeneratedInterfaceDiagnostic {
  readonly code: string
  readonly line: number
  readonly column: number
  readonly message: string
}

/** Operational failure outside generated model content. */
export class GeneratedInterfaceCheckError extends Error {
  readonly code:
    | "incompatible_generation"
    | "compiler_unavailable"
    | "invalid_configuration"
    | "internal_error"

  constructor(code: GeneratedInterfaceCheckError["code"], options?: ErrorOptions) {
    super(generatedInterfaceCheckErrorMessages[code], options)
    this.name = "GeneratedInterfaceCheckError"
    this.code = code
  }
}

const generatedInterfaceCheckErrorMessages = {
  incompatible_generation: "Generated-interface checking requires a compatible GenUI Generation.",
  compiler_unavailable: "The generated-interface compiler is unavailable.",
  invalid_configuration: "The generated-interface checker configuration is invalid.",
  internal_error: "Generated-interface checking failed unexpectedly.",
} as const satisfies Record<GeneratedInterfaceCheckError["code"], string>

export type GeneratedInterfaceCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
      readonly report: string
    }

export interface InlineModule {
  readonly path: string
  readonly source: string
  readonly startLine: number
  readonly startColumn: number
}

interface ParsedContent {
  readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
  readonly modules: readonly InlineModule[]
}

export type GeneratedInterfaceCompilerResult =
  | {
      readonly ok: true
      readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
    }
  | {
      readonly ok: false
      readonly code: "compiler_unavailable" | "invalid_configuration"
      readonly cause?: unknown
    }

export interface GeneratedInterfaceCompiler {
  check(
    contract: GenerationCheckerContract,
    modules: readonly InlineModule[],
    signal: AbortSignal,
  ): Promise<GeneratedInterfaceCompilerResult>
}

interface GeneratedInterfaceCheckerDependencies {
  readonly compiler: GeneratedInterfaceCompiler
  readonly readContract: typeof readGenerationCheckerContract
}

const projectRoot = "/__genui_check__"
const contractPath = `${projectRoot}/genui.d.ts`
const tsconfigPath = `${projectRoot}/tsconfig.json`
const maxReportedDiagnostics = 8
const maxDiagnosticMessageLength = 1_000
const maxReportLength = 8_000
const maxReportLineLength = 160
const htmlNamespace = "http://www.w3.org/1999/xhtml"

const checkerDomDeclarations = `
// The checker validates syntax and the GenUI contract, not DOM element specialization. Generated
// interfaces commonly select controls by dynamic IDs, where lib.dom cannot infer the element type.
interface ParentNode {
  querySelector(selectors: string): any
  querySelectorAll(selectors: string): NodeListOf<any>
}

interface Document {
  getElementById(elementId: string): any
}
`

export const createGeneratedInterfaceChecker =
  ({
    compiler,
    readContract,
  }: GeneratedInterfaceCheckerDependencies): ((
    generation: Generation,
    options: CheckGeneratedInterfaceOptions,
  ) => Promise<GeneratedInterfaceCheckResult>) =>
  async (generation, options) => {
    const signal = options.signal ?? new AbortController().signal
    try {
      throwIfAborted(signal)
      const contract = readContract(generation)
      if (
        contract === undefined ||
        contract.version !== generationCheckerContractVersion ||
        contract.dialect !== "code/0"
      ) {
        throw new GeneratedInterfaceCheckError("incompatible_generation")
      }
      const parsed = parseGeneratedContent(options.content)
      throwIfAborted(signal)

      const compiled =
        parsed.modules.length === 0
          ? ({ ok: true, diagnostics: [] } as const)
          : await compiler.check(contract, parsed.modules, signal)
      throwIfAborted(signal)
      if (!compiled.ok) {
        throw new GeneratedInterfaceCheckError(compiled.code, { cause: compiled.cause })
      }
      const diagnostics = [...parsed.diagnostics, ...compiled.diagnostics].sort(compareDiagnostics)
      if (diagnostics.length === 0) return { ok: true }

      return invalidResult(options.content, diagnostics)
    } catch (cause) {
      if (signal.aborted) throw signal.reason
      if (cause instanceof GeneratedInterfaceCheckError) throw cause
      throw new GeneratedInterfaceCheckError("internal_error", { cause })
    }
  }

export const typescriptGeneratedInterfaceCompiler: GeneratedInterfaceCompiler = {
  check: checkModules,
}

/** Check inline module scripts against one selected Generation before creating a surface. */
export const checkGeneratedInterface = createGeneratedInterfaceChecker({
  compiler: typescriptGeneratedInterfaceCompiler,
  readContract: readGenerationCheckerContract,
})

const parseGeneratedContent = (content: string): ParsedContent => {
  const diagnostics: GeneratedInterfaceDiagnostic[] = []
  const parseErrors: ParserError[] = []
  const fragment = parseFragment(content, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error),
  })

  for (const error of parseErrors) {
    diagnostics.push({
      code: `HTML:${error.code}`,
      line: error.startLine,
      column: error.startCol,
      message: `Invalid HTML: ${error.code.replaceAll("-", " ")}.`,
    })
  }
  if (parseErrors.length > 0) return { diagnostics, modules: [] }

  const modules: InlineModule[] = []
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      if (node.tagName === "template") return
      if (node.tagName === "script") {
        const location = node.sourceCodeLocation?.startTag
        const line = location?.startLine ?? 1
        const column = location?.startCol ?? 1
        const source = node.attrs.find(({ name }) => name === "src")
        if (source !== undefined) {
          diagnostics.push({
            code: "GENUI001",
            line,
            column,
            message: "Generated interface scripts must be inline.",
          })
          return
        }
        const type = node.attrs
          .find(({ name }) => name === "type")
          ?.value.trim()
          .toLowerCase()
        if (node.namespaceURI !== htmlNamespace || type !== "module") {
          diagnostics.push({
            code: "GENUI002",
            line,
            column,
            message: 'Generated interface scripts must use type="module".',
          })
          return
        }
        if (location === undefined) {
          diagnostics.push({
            code: "GENUI003",
            line,
            column,
            message: "Generated interface script location could not be determined.",
          })
          return
        }
        modules.push({
          path: `${projectRoot}/script-${String(modules.length + 1)}.mjs`,
          source: node.childNodes
            .filter(
              (child): child is DefaultTreeAdapterTypes.TextNode => child.nodeName === "#text",
            )
            .map((child) => child.value)
            .join(""),
          startLine: location.endLine,
          startColumn: location.endCol,
        })
        return
      }
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) visit(child)
    }
  }

  for (const child of fragment.childNodes) visit(child)
  return { diagnostics, modules }
}

async function checkModules(
  contract: GenerationCheckerContract,
  modules: readonly InlineModule[],
  signal: AbortSignal,
): Promise<GeneratedInterfaceCompilerResult> {
  const files: Record<string, string> = {
    [contractPath]: `${contract.guestDeclarations}\n${checkerDomDeclarations}\n${contract.capabilityDeclarations}`,
    [tsconfigPath]: JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          lib: ["es2024", "dom"],
          module: "esnext",
          moduleResolution: "bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: false,
          target: "es2024",
        },
        files: ["genui.d.ts", ...modules.map(({ path }) => path.slice(projectRoot.length + 1))],
      },
      null,
      2,
    ),
  }
  for (const module of modules) files[module.path] = module.source

  const loadedCompiler = await Promise.all([
    import("typescript/unstable/async"),
    import("typescript/unstable/fs"),
  ]).then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({ ok: false as const, cause }),
  )
  if (!loadedCompiler.ok) {
    return { ok: false, code: "compiler_unavailable", cause: loadedCompiler.cause }
  }
  throwIfAborted(signal)

  const [{ API }, { createVirtualFileSystem }] = loadedCompiler.value
  const openedCompiler = (() => {
    try {
      const virtualFileSystem = createVirtualFileSystem(files)
      return {
        ok: true as const,
        api: new API({
          cwd: projectRoot,
          fs: {
            ...virtualFileSystem,
            writeFile: (path) => {
              throw new Error(`Generated-interface checking must not write files: ${path}`)
            },
            removeFile: (path) => {
              throw new Error(`Generated-interface checking must not remove files: ${path}`)
            },
          },
        }),
      }
    } catch (cause) {
      return { ok: false as const, cause }
    }
  })()
  if (!openedCompiler.ok) {
    return { ok: false, code: "compiler_unavailable", cause: openedCompiler.cause }
  }
  const { api } = openedCompiler

  try {
    throwIfAborted(signal)
    const openedProject = await api.updateSnapshot({ openProject: tsconfigPath }).then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => ({ ok: false as const, cause }),
    )
    if (!openedProject.ok) {
      return { ok: false, code: "compiler_unavailable", cause: openedProject.cause }
    }
    const snapshot = openedProject.value
    try {
      throwIfAborted(signal)
      const project = snapshot.getProjects()[0]
      if (project === undefined) {
        return {
          ok: false,
          code: "compiler_unavailable",
          cause: new Error("Generated-interface checking did not create a TypeScript project."),
        }
      }
      const configDiagnostics = await project.program.getConfigFileParsingDiagnostics()
      throwIfAborted(signal)
      if (configDiagnostics.length > 0) {
        return {
          ok: false,
          code: "invalid_configuration",
          cause: new Error(
            `Generated-interface checker configuration produced TS${String(configDiagnostics[0]?.code ?? "unknown")}.`,
          ),
        }
      }
      const syntactic = await project.program.getSyntacticDiagnostics()
      throwIfAborted(signal)
      const semantic = await project.program.getSemanticDiagnostics()
      throwIfAborted(signal)
      const compilerDiagnostics = [...syntactic, ...semantic]
      const declarationDiagnostic = compilerDiagnostics.find(
        (diagnostic) => !modules.some(({ path }) => path === diagnostic.fileName),
      )
      if (declarationDiagnostic !== undefined) {
        return {
          ok: false,
          code: "invalid_configuration",
          cause: new Error(
            `Generated-interface checker declarations produced TS${String(declarationDiagnostic.code)}.`,
          ),
        }
      }
      return {
        ok: true,
        diagnostics: compilerDiagnostics.map((diagnostic) =>
          serializeTypeScriptDiagnostic(diagnostic, modules),
        ),
      }
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await api.close()
  }
}

const serializeTypeScriptDiagnostic = (
  diagnostic: Diagnostic,
  modules: readonly InlineModule[],
): GeneratedInterfaceDiagnostic => {
  const module = modules.find(({ path }) => path === diagnostic.fileName)
  if (module === undefined) {
    throw new Error(
      `Generated-interface checker declaration failed: TS${String(diagnostic.code)} ${diagnostic.text}`,
    )
  }
  const position = lineAndColumn(module.source, diagnostic.pos)
  return {
    code: `TS${String(diagnostic.code)}`,
    line: module.startLine + position.line - 1,
    column: position.line === 1 ? module.startColumn + position.column - 1 : position.column,
    message: truncate(diagnostic.text, maxDiagnosticMessageLength),
  }
}

const invalidResult = (
  content: string,
  allDiagnostics: readonly GeneratedInterfaceDiagnostic[],
): Extract<GeneratedInterfaceCheckResult, { readonly ok: false }> => {
  const diagnostics = allDiagnostics.slice(0, maxReportedDiagnostics)
  const blocks = diagnostics.map((diagnostic, index) =>
    formatDiagnostic(content, diagnostic, index + 1),
  )
  if (allDiagnostics.length > diagnostics.length) {
    blocks.push(
      `... ${String(allDiagnostics.length - diagnostics.length)} additional diagnostic(s) omitted.`,
    )
  }
  return {
    ok: false,
    diagnostics,
    report: truncate(
      [
        `Generated interface check failed with ${String(allDiagnostics.length)} diagnostic(s).`,
        "",
        blocks.join("\n\n"),
      ].join("\n"),
      maxReportLength,
    ),
  }
}

const formatDiagnostic = (
  content: string,
  diagnostic: GeneratedInterfaceDiagnostic,
  index: number,
): string => {
  const sourceLine = content.split("\n")[diagnostic.line - 1] ?? ""
  const trimmed = trimReportLine(sourceLine, diagnostic.column)
  const gutter = String(diagnostic.line)
  return [
    `${String(index)}. ${diagnostic.code} at surface.html:${String(diagnostic.line)}:${String(diagnostic.column)}`,
    ...diagnostic.message.split("\n").map((line) => `   ${line}`),
    "",
    `   ${gutter} | ${trimmed.text}`,
    `   ${" ".repeat(gutter.length)} | ${" ".repeat(trimmed.column - 1)}^`,
  ].join("\n")
}

const trimReportLine = (
  line: string,
  column: number,
): { readonly text: string; readonly column: number } => {
  if (line.length <= maxReportLineLength) return { text: line, column }
  const halfWidth = Math.floor((maxReportLineLength - 3) / 2)
  const start = Math.max(0, column - halfWidth - 1)
  const end = Math.min(line.length, start + maxReportLineLength - 3)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < line.length ? "..." : ""
  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    column: Math.max(1, column - start + prefix.length),
  }
}

const lineAndColumn = (
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } => {
  let line = 1
  let column = 1
  const end = Math.max(0, Math.min(offset, source.length))
  for (let index = 0; index < end; index += 1) {
    if (source[index] === "\n") {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

const compareDiagnostics = (
  left: GeneratedInterfaceDiagnostic,
  right: GeneratedInterfaceDiagnostic,
): number =>
  left.line - right.line || left.column - right.column || left.code.localeCompare(right.code)

const truncate = (value: string, maximumLength: number): string => {
  if (value.length <= maximumLength) return value
  const suffix = "... <truncated>"
  return `${value.slice(0, maximumLength - suffix.length)}${suffix}`
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (!signal.aborted) return
  throw signal.reason
}
