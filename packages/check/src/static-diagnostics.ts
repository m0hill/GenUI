import type { Project, Symbol as TypeScriptSymbol } from "typescript/unstable/async"
import type {
  CallExpression,
  Expression,
  Identifier,
  Node,
  SourceFile,
} from "typescript/unstable/ast"
import type { GenerationCheckerContract } from "genui"
import type { JsonSchema } from "genui/protocol"
import type { GeneratedInterfaceDiagnostic, InlineModule } from "./checker.js"

type AstApi = typeof import("typescript/unstable/ast")
type AstPredicates = typeof import("typescript/unstable/ast/is")

interface ModuleSource {
  readonly module: InlineModule
  readonly sourceFile: SourceFile
}

interface StaticAnalysisContext {
  readonly ast: AstApi
  readonly is: AstPredicates
  readonly symbols: ReadonlyMap<Identifier, TypeScriptSymbol | undefined>
  readonly undefinedSymbolIds: ReadonlySet<number>
}

type NullishValue = "null" | "undefined"
type Compatibility = "compatible" | "incompatible" | "unknown"

const networkGlobals = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "Worker",
  "SharedWorker",
])

const storageGlobals = new Set([
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "cookieStore",
])

const parentGlobals = new Set(["parent", "top", "opener", "frameElement"])
const jsonSchemaTypes = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
])
const locationMethods = new Set(["assign", "replace", "reload"])
const historyMethods = new Set(["back", "forward", "go", "pushState", "replaceState"])
const navigationMethods = new Set([
  "navigate",
  "reload",
  "traverseTo",
  "back",
  "forward",
  "updateCurrentEntry",
])
const symbolAwareNames = new Set([
  ...networkGlobals,
  ...storageGlobals,
  ...parentGlobals,
  "window",
  "self",
  "globalThis",
  "document",
  "navigator",
  "location",
  "history",
  "navigation",
  "open",
  "eval",
  "Function",
  "setTimeout",
  "setInterval",
  "genui",
  "undefined",
])

const messages = {
  GENUI007: "Generated interfaces cannot load or re-export modules.",
  GENUI008: "Generated interfaces cannot use direct network or worker-loading APIs.",
  GENUI009: "Generated interfaces cannot use persistent browser storage.",
  GENUI010: "Generated interfaces cannot access a parent page, opener, or frame owner.",
  GENUI011: "Generated interfaces cannot navigate directly.",
  GENUI012: "Generated interfaces cannot generate or evaluate code at runtime.",
  GENUI013: "document.currentScript is always null in generated module scripts.",
} as const

export const collectStaticDiagnostics = async (
  contract: GenerationCheckerContract,
  modules: readonly InlineModule[],
  project: Project,
  ast: AstApi,
  is: AstPredicates,
  signal: AbortSignal,
): Promise<readonly GeneratedInterfaceDiagnostic[]> => {
  const sources = await Promise.all(
    modules.map(async (module): Promise<ModuleSource> => {
      const sourceFile = await project.program.getSourceFile(module.path)
      if (sourceFile === undefined) {
        throw new Error(`Generated-interface module is missing from the compiler: ${module.path}`)
      }
      return { module, sourceFile }
    }),
  )
  throwIfAborted(signal)

  const identifiers: Identifier[] = []
  for (const { sourceFile } of sources) {
    visit(sourceFile, (node) => {
      if (is.isIdentifier(node) && symbolAwareNames.has(node.text)) identifiers.push(node)
    })
  }
  const resolvedSymbols =
    identifiers.length === 0 ? [] : await project.checker.getSymbolAtLocation(identifiers)
  throwIfAborted(signal)

  const symbols = new Map(
    identifiers.map((identifier, index) => [identifier, resolvedSymbols[index]] as const),
  )
  const undefinedSymbolIds = new Set<number>()
  for (const symbol of new Set(
    identifiers
      .filter(({ text }) => text === "undefined")
      .map((identifier) => symbols.get(identifier))
      .filter((symbol): symbol is TypeScriptSymbol => symbol !== undefined),
  )) {
    if (await project.checker.isUndefinedSymbol(symbol)) undefinedSymbolIds.add(symbol.id)
  }
  throwIfAborted(signal)

  const context: StaticAnalysisContext = {
    ast,
    is,
    symbols,
    undefinedSymbolIds,
  }
  const diagnostics: GeneratedInterfaceDiagnostic[] = []
  for (const source of sources) {
    collectModuleDiagnostics(contract, source, context, diagnostics)
  }
  const seen = new Set<string>()
  return diagnostics.filter((candidate) => {
    const key = JSON.stringify(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const collectModuleDiagnostics = (
  contract: GenerationCheckerContract,
  source: ModuleSource,
  context: StaticAnalysisContext,
  diagnostics: GeneratedInterfaceDiagnostic[],
): void => {
  const { is } = context
  visit(source.sourceFile, (node) => {
    if (is.isImportDeclaration(node)) {
      diagnostics.push(diagnostic(source, node, "GENUI007", messages.GENUI007))
      return false
    }
    if (is.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      diagnostics.push(diagnostic(source, node, "GENUI007", messages.GENUI007))
      return false
    }
    if (is.isCallExpression(node)) {
      collectCallDiagnostics(contract, source, node, context, diagnostics)
    } else if (is.isNewExpression(node)) {
      if (isDirectGlobal(node.expression, "Function", source.module.path, context)) {
        diagnostics.push(diagnostic(source, node, "GENUI012", messages.GENUI012))
      } else if (
        [...networkGlobals].some((name) =>
          isDirectGlobal(node.expression, name, source.module.path, context),
        )
      ) {
        diagnostics.push(diagnostic(source, node, "GENUI008", messages.GENUI008))
      }
    } else if (is.isBinaryExpression(node)) {
      const { SyntaxKind } = context.ast
      if (
        node.operatorToken.kind >= SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= SyntaxKind.LastAssignment &&
        isLocationWrite(node.left, source.module.path, context)
      ) {
        diagnostics.push(diagnostic(source, node.left, "GENUI011", messages.GENUI011))
      }
    }

    if (!isDirectReferenceExpression(node, context)) return
    if (
      !isInvocationTarget(node, context) &&
      ([...networkGlobals].some((name) =>
        isDirectGlobal(node, name, source.module.path, context),
      ) ||
        isMemberOfGlobal(node, "navigator", "sendBeacon", source.module.path, context) ||
        isNestedMemberOfGlobal(
          node,
          "navigator",
          "serviceWorker",
          "register",
          source.module.path,
          context,
        ))
    ) {
      diagnostics.push(diagnostic(source, node, "GENUI008", messages.GENUI008))
    } else if (
      [...storageGlobals].some((name) => isDirectGlobal(node, name, source.module.path, context)) ||
      isMemberOfGlobal(node, "document", "cookie", source.module.path, context)
    ) {
      diagnostics.push(diagnostic(source, node, "GENUI009", messages.GENUI009))
    } else if (
      [...parentGlobals].some((name) => isDirectGlobal(node, name, source.module.path, context))
    ) {
      diagnostics.push(diagnostic(source, node, "GENUI010", messages.GENUI010))
    } else if (isMemberOfGlobal(node, "document", "currentScript", source.module.path, context)) {
      diagnostics.push(diagnostic(source, node, "GENUI013", messages.GENUI013))
    }
  })
}

const collectCallDiagnostics = (
  contract: GenerationCheckerContract,
  source: ModuleSource,
  call: CallExpression,
  context: StaticAnalysisContext,
  diagnostics: GeneratedInterfaceDiagnostic[],
): void => {
  const { is } = context
  if (is.isImportExpression(call.expression)) {
    diagnostics.push(diagnostic(source, call, "GENUI007", messages.GENUI007))
    return
  }

  const genuiMember = staticMember(call.expression, context)
  if (
    genuiMember !== undefined &&
    (genuiMember.name === "call" || genuiMember.name === "subscribe") &&
    isDirectGlobal(genuiMember.object, "genui", source.module.path, context)
  ) {
    const capabilityName = staticString(call.arguments[0], context)
    const input = nullishValue(call.arguments[1], source.module.path, context)
    if (capabilityName !== undefined && input !== undefined) {
      const kind = genuiMember.name === "call" ? "action" : "subscription"
      const capability = contract.capabilityInputs.find(
        (candidate) => candidate.kind === kind && candidate.name === capabilityName,
      )
      if (
        capability?.schema !== undefined &&
        schemaCompatibility(capability.schema, input) === "incompatible"
      ) {
        diagnostics.push(
          diagnostic(
            source,
            call.arguments[1]!,
            "GENUI006",
            `The selected ${kind} input excludes ${input}.`,
          ),
        )
      }
    }
  }

  if (
    [...networkGlobals].some((name) =>
      isDirectGlobal(call.expression, name, source.module.path, context),
    ) ||
    isMemberOfGlobal(call.expression, "navigator", "sendBeacon", source.module.path, context) ||
    isNestedMemberOfGlobal(
      call.expression,
      "navigator",
      "serviceWorker",
      "register",
      source.module.path,
      context,
    )
  ) {
    diagnostics.push(diagnostic(source, call, "GENUI008", messages.GENUI008))
    return
  }

  if (
    isDirectGlobal(call.expression, "open", source.module.path, context) ||
    [...locationMethods].some((method) =>
      isMemberOfGlobal(call.expression, "location", method, source.module.path, context),
    ) ||
    [...historyMethods].some((method) =>
      isMemberOfGlobal(call.expression, "history", method, source.module.path, context),
    ) ||
    [...navigationMethods].some((method) =>
      isMemberOfGlobal(call.expression, "navigation", method, source.module.path, context),
    )
  ) {
    diagnostics.push(diagnostic(source, call, "GENUI011", messages.GENUI011))
    return
  }

  if (
    isDirectGlobal(call.expression, "eval", source.module.path, context) ||
    isDirectGlobal(call.expression, "Function", source.module.path, context) ||
    ((isDirectGlobal(call.expression, "setTimeout", source.module.path, context) ||
      isDirectGlobal(call.expression, "setInterval", source.module.path, context)) &&
      isStringExpression(call.arguments[0], context))
  ) {
    diagnostics.push(diagnostic(source, call, "GENUI012", messages.GENUI012))
  }
}

const isLocationWrite = (
  expression: Expression,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean =>
  isDirectGlobal(expression, "location", modulePath, context) ||
  isMemberOfGlobal(expression, "location", "href", modulePath, context)

const isDirectGlobal = (
  expression: Expression,
  name: string,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean => {
  const unwrapped = context.is.skipOuterExpressions(expression)
  if (context.is.isIdentifier(unwrapped)) {
    return (
      unwrapped.text === name &&
      isBareIdentifier(unwrapped, context) &&
      isAmbientIdentifier(unwrapped, modulePath, context)
    )
  }
  const member = staticMember(unwrapped, context)
  return member?.name === name && isGlobalObject(member.object, modulePath, context)
}

const isGlobalObject = (
  expression: Expression,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean => {
  const unwrapped = context.is.skipOuterExpressions(expression)
  return (
    context.is.isIdentifier(unwrapped) &&
    (unwrapped.text === "window" || unwrapped.text === "self" || unwrapped.text === "globalThis") &&
    isBareIdentifier(unwrapped, context) &&
    isAmbientIdentifier(unwrapped, modulePath, context)
  )
}

const isMemberOfGlobal = (
  expression: Expression,
  globalName: string,
  memberName: string,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean => {
  const member = staticMember(expression, context)
  return (
    member?.name === memberName && isDirectGlobal(member.object, globalName, modulePath, context)
  )
}

const isNestedMemberOfGlobal = (
  expression: Expression,
  globalName: string,
  intermediateName: string,
  memberName: string,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean => {
  const member = staticMember(expression, context)
  if (member?.name !== memberName) return false
  return isMemberOfGlobal(member.object, globalName, intermediateName, modulePath, context)
}

const staticMember = (
  expression: Expression,
  context: StaticAnalysisContext,
): { readonly object: Expression; readonly name: string } | undefined => {
  const unwrapped = context.is.skipOuterExpressions(expression)
  if (context.is.isPropertyAccessExpression(unwrapped)) {
    if (!context.is.isIdentifier(unwrapped.name)) return undefined
    return { object: unwrapped.expression, name: unwrapped.name.text }
  }
  if (context.is.isElementAccessExpression(unwrapped)) {
    const name = staticString(unwrapped.argumentExpression, context)
    return name === undefined ? undefined : { object: unwrapped.expression, name }
  }
  return undefined
}

const staticString = (
  expression: Expression | undefined,
  context: StaticAnalysisContext,
): string | undefined => {
  if (expression === undefined) return undefined
  const unwrapped = context.is.skipOuterExpressions(expression)
  return context.is.isStringLiteral(unwrapped) ||
    context.is.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : undefined
}

const isStringExpression = (
  expression: Expression | undefined,
  context: StaticAnalysisContext,
): boolean => {
  if (expression === undefined) return false
  const unwrapped = context.is.skipOuterExpressions(expression)
  return (
    context.is.isStringLiteral(unwrapped) ||
    context.is.isNoSubstitutionTemplateLiteral(unwrapped) ||
    context.is.isTemplateExpression(unwrapped)
  )
}

const nullishValue = (
  expression: Expression | undefined,
  modulePath: string,
  context: StaticAnalysisContext,
): NullishValue | undefined => {
  if (expression === undefined) return undefined
  const unwrapped = context.is.skipOuterExpressions(expression)
  if (context.is.isNullLiteral(unwrapped)) return "null"
  if (
    context.is.isIdentifier(unwrapped) &&
    unwrapped.text === "undefined" &&
    isBareIdentifier(unwrapped, context) &&
    isAmbientIdentifier(unwrapped, modulePath, context)
  ) {
    return "undefined"
  }
  return undefined
}

const isAmbientIdentifier = (
  identifier: Identifier,
  modulePath: string,
  context: StaticAnalysisContext,
): boolean => {
  const symbol = context.symbols.get(identifier)
  if (symbol === undefined) return false
  if (context.undefinedSymbolIds.has(symbol.id)) return true
  return !symbol.declarations.some(({ path }) => path === modulePath)
}

const isBareIdentifier = (identifier: Identifier, context: StaticAnalysisContext): boolean => {
  const parent = identifier.parent
  return !(
    (context.is.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (context.is.isPropertyAssignment(parent) && parent.name === identifier)
  )
}

const isDirectReferenceExpression = (
  node: Node,
  context: StaticAnalysisContext,
): node is Expression =>
  (context.is.isIdentifier(node) && isBareIdentifier(node, context)) ||
  context.is.isPropertyAccessExpression(node) ||
  context.is.isElementAccessExpression(node)

const isInvocationTarget = (expression: Expression, context: StaticAnalysisContext): boolean => {
  let current: Node = expression
  while (
    context.is.isParenthesizedExpression(current.parent) &&
    current.parent.expression === current
  ) {
    current = current.parent
  }
  return (
    (context.is.isCallExpression(current.parent) || context.is.isNewExpression(current.parent)) &&
    current.parent.expression === current
  )
}

const schemaCompatibility = (schema: JsonSchema, value: NullishValue): Compatibility => {
  if (value === "null" && schema.nullable === true) return "compatible"

  const constraints: Compatibility[] = []
  if (typeof schema.type === "string") {
    constraints.push(
      jsonSchemaTypes.has(schema.type)
        ? value === "null" && schema.type === "null"
          ? "compatible"
          : "incompatible"
        : "unknown",
    )
  } else if (Array.isArray(schema.type)) {
    constraints.push(
      schema.type.every(
        (candidate: unknown) => typeof candidate === "string" && jsonSchemaTypes.has(candidate),
      )
        ? value === "null" && schema.type.includes("null")
          ? "compatible"
          : "incompatible"
        : "unknown",
    )
  }
  if (Object.hasOwn(schema, "const")) {
    constraints.push(
      schema.const === (value === "null" ? null : undefined) ? "compatible" : "incompatible",
    )
  }
  if (Array.isArray(schema.enum)) {
    constraints.push(
      schema.enum.includes(value === "null" ? null : undefined) ? "compatible" : "incompatible",
    )
  }
  if (Array.isArray(schema.allOf)) {
    constraints.push(
      combineAll(schema.allOf.map((candidate: unknown) => schemaEntry(candidate, value))),
    )
  }
  if (Array.isArray(schema.anyOf)) {
    constraints.push(
      combineAny(schema.anyOf.map((candidate: unknown) => schemaEntry(candidate, value))),
    )
  }
  if (Array.isArray(schema.oneOf)) {
    constraints.push(
      combineOne(schema.oneOf.map((candidate: unknown) => schemaEntry(candidate, value))),
    )
  }
  if (isSchema(schema.not)) {
    const compatibility = schemaCompatibility(schema.not, value)
    constraints.push(
      compatibility === "compatible"
        ? "incompatible"
        : compatibility === "incompatible"
          ? "compatible"
          : "unknown",
    )
  }

  return combineAll(constraints)
}

const schemaEntry = (value: unknown, nullish: NullishValue): Compatibility =>
  isSchema(value) ? schemaCompatibility(value, nullish) : "unknown"

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const combineAll = (values: readonly Compatibility[]): Compatibility => {
  if (values.some((value) => value === "incompatible")) return "incompatible"
  if (values.length > 0 && values.every((value) => value === "compatible")) return "compatible"
  return "unknown"
}

const combineAny = (values: readonly Compatibility[]): Compatibility => {
  if (values.some((value) => value === "compatible")) return "compatible"
  if (values.length > 0 && values.every((value) => value === "incompatible")) {
    return "incompatible"
  }
  return "unknown"
}

const combineOne = (values: readonly Compatibility[]): Compatibility => {
  const compatible = values.filter((value) => value === "compatible").length
  if (values.some((value) => value === "unknown")) return "unknown"
  return compatible === 1 ? "compatible" : "incompatible"
}

const diagnostic = (
  source: ModuleSource,
  node: Node,
  code: string,
  message: string,
): GeneratedInterfaceDiagnostic => {
  const position = source.sourceFile.getLineAndCharacterOfPosition(node.getStart(source.sourceFile))
  return {
    code,
    line: source.module.startLine + position.line,
    column:
      position.line === 0 ? source.module.startColumn + position.character : position.character + 1,
    message,
  }
}

const visit = (node: Node, visitor: (node: Node) => boolean | void): void => {
  if (visitor(node) === false) return
  node.forEachChild((child) => visit(child, visitor))
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (!signal.aborted) return
  throw signal.reason
}
