import { parseFragment, type DefaultTreeAdapterTypes, type ParserError } from "parse5"
import { API, type Diagnostic } from "typescript/unstable/async"
import { createVirtualFileSystem } from "typescript/unstable/fs"
import { generationCapabilityDeclarations, type Generation } from "../generation.js"

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

export type GeneratedInterfaceCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
      readonly report: string
    }

interface InlineModule {
  readonly path: string
  readonly source: string
  readonly startLine: number
  readonly startColumn: number
}

interface ParsedContent {
  readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
  readonly modules: readonly InlineModule[]
}

const projectRoot = "/__genui_check__"
const contractPath = `${projectRoot}/genui.d.ts`
const tsconfigPath = `${projectRoot}/tsconfig.json`
const maxReportedDiagnostics = 8
const maxDiagnosticMessageLength = 1_000
const maxReportLength = 8_000
const maxReportLineLength = 160
const htmlNamespace = "http://www.w3.org/1999/xhtml"

const guestDeclarations = `
type GenuiJson = null | boolean | number | string | readonly GenuiJson[] | {
  readonly [key: string]: GenuiJson
}

interface GenuiHostContext {
  readonly theme?: "light" | "dark"
  readonly containerDimensions?: {
    readonly height?: number
    readonly maxHeight?: number
    readonly width?: number
    readonly maxWidth?: number
  }
  readonly locale?: string
  readonly timeZone?: string
  readonly platform?: string
}

interface GenuiSubscriptionHandle {
  unsubscribe(): Promise<void>
  readonly done: Promise<
    | { readonly ok: true; readonly reason: "completed" | "unsubscribed" }
    | {
        readonly ok: false
        readonly error: { readonly code: string; readonly message: string }
      }
  >
}

// The checker validates syntax and the GenUI contract, not DOM element specialization. Generated
// interfaces commonly select controls by dynamic IDs, where lib.dom cannot infer the element type.
interface ParentNode {
  querySelector(selectors: string): any
  querySelectorAll(selectors: string): NodeListOf<any>
}

interface Document {
  getElementById(elementId: string): any
}

interface Genui {
  readonly surfaceId: string
  readonly hostContext: GenuiHostContext
  readonly sendMessage?: (text: string) => Promise<void>
  readonly openLink?: (url: string) => Promise<void>
  readonly updateModelContext?: (params: {
    readonly content?: string
    readonly structuredContent?: Readonly<Record<string, GenuiJson>>
  }) => Promise<void>
  onHostContextChange(handler: (partial: GenuiHostContext) => void | Promise<void>): void
  snapshot(provider: (restored?: any) => GenuiJson | Promise<GenuiJson>): void
  teardown(handler: (context: { readonly reason?: string }) => void | Promise<void>): void
}

interface Window {
  readonly genui: Readonly<Genui>
}

declare const genui: Readonly<Genui>
`

/** Check inline module scripts against one selected Generation before creating a surface. */
export const checkGeneratedInterface = async (
  generation: Generation,
  options: CheckGeneratedInterfaceOptions,
): Promise<GeneratedInterfaceCheckResult> => {
  const signal = options.signal ?? new AbortController().signal
  throwIfAborted(signal)
  const parsed = parseGeneratedContent(options.content)
  throwIfAborted(signal)

  const compilerDiagnostics =
    parsed.modules.length === 0 ? [] : await checkModules(generation, parsed.modules, signal)
  const diagnostics = [...parsed.diagnostics, ...compilerDiagnostics].sort(compareDiagnostics)
  if (diagnostics.length === 0) return { ok: true }

  return invalidResult(options.content, diagnostics)
}

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

const checkModules = async (
  generation: Generation,
  modules: readonly InlineModule[],
  signal: AbortSignal,
): Promise<readonly GeneratedInterfaceDiagnostic[]> => {
  const files: Record<string, string> = {
    [contractPath]: `${guestDeclarations}\n${generationCapabilityDeclarations(generation)}`,
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

  const virtualFileSystem = createVirtualFileSystem(files)
  const api = new API({
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
  })

  try {
    throwIfAborted(signal)
    const snapshot = await api.updateSnapshot({ openProject: tsconfigPath })
    try {
      throwIfAborted(signal)
      const project = snapshot.getProjects()[0]
      if (project === undefined) {
        throw new Error("Generated-interface checking did not create a TypeScript project.")
      }
      const configDiagnostics = await project.program.getConfigFileParsingDiagnostics()
      throwIfAborted(signal)
      if (configDiagnostics.length > 0) {
        throw new Error(
          `Invalid generated-interface checker configuration: ${configDiagnostics[0]?.text}`,
        )
      }
      const syntactic = await project.program.getSyntacticDiagnostics()
      throwIfAborted(signal)
      const semantic = await project.program.getSemanticDiagnostics()
      throwIfAborted(signal)
      return [...syntactic, ...semantic].map((diagnostic) =>
        serializeTypeScriptDiagnostic(diagnostic, modules),
      )
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
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Generated-interface checking was aborted.")
}
