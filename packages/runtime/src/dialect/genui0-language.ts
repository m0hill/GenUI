export interface Genui0CapabilityAction {
  readonly capability: string
  readonly inputExpression: string
  readonly target?: string
}

export interface Genui0SandboxCapabilityAction {
  readonly capability: string
  readonly input: unknown
  readonly target?: string
}

export interface Genui0SetAction {
  readonly pathExpression: string
  readonly valueExpression: string
}

export interface Genui0SandboxSetAction {
  readonly path: readonly string[]
  readonly value: unknown
}

export interface Genui0Language {
  readonly invalid: symbol
  isCapabilityName(value: string): boolean
  isStateName(value: string): boolean
  isStatePath(value: string): boolean
  isSafeScalarExpression(value: string): boolean
  isSafeObjectExpression(value: string): boolean
  isSafeSimpleExpression(value: string): boolean
  isSafeBindingExpression(value: string): boolean
  parseCapabilityAction(value: string): Genui0CapabilityAction | undefined
  parseSetAction(value: string): Genui0SetAction | undefined
  parseObjectLiteral(source: string, readState: (expression: string) => unknown): unknown
  evaluateExpression(source: string, readState: (expression: string) => unknown): unknown
  parseCapabilityExpression(
    expression: string,
    readState: (expression: string) => unknown,
  ): Genui0SandboxCapabilityAction | undefined
  parseSetExpression(
    expression: string,
    readState: (expression: string) => unknown,
  ): Genui0SandboxSetAction | undefined
  defaultResultTarget(capability: string): string
  normalizeResultTarget(target: string | undefined, capability: string): string
}

/** Build the genui/0 expression grammar used by sanitizer checks and the sandbox runtime. */
export const createGenui0Language = (): Genui0Language => {
  const capabilityNamePatternSource = "[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+"
  const bareIdentifierPatternSource = "_?[A-Za-z][A-Za-z0-9_]*"
  const statePathPatternSource = "\\$_?[A-Za-z][A-Za-z0-9_]*(?:\\._?[A-Za-z][A-Za-z0-9_]*)*"
  const numberLiteralPatternSource = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"
  const stringLiteralPatternSource = "(?:\"[^\"\\\\<>]*\"|'[^'\\\\<>]*')"

  const exactPattern = (source: string, flags?: string): RegExp => new RegExp(`^${source}$`, flags)

  const capabilityNamePattern = exactPattern(capabilityNamePatternSource, "i")
  const bareIdentifierPattern = exactPattern(bareIdentifierPatternSource)
  const statePathPattern = exactPattern(statePathPatternSource)
  const numberLiteralPattern = exactPattern(numberLiteralPatternSource)
  const stringLiteralPattern = exactPattern(stringLiteralPatternSource)
  const invalid = Symbol("genui0.invalid")

  const splitOutsideQuotes = (source: string, separator: string): string[] | undefined => {
    const parts: string[] = []
    let quote: '"' | "'" | undefined
    let start = 0

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]
      if (character === undefined) return undefined
      if (character === "\\") return undefined

      if (quote !== undefined) {
        if (character === quote) quote = undefined
        continue
      }

      if (character === '"' || character === "'") {
        quote = character
        continue
      }

      if ("()[]{}".includes(character)) return undefined
      if (character === separator) {
        parts.push(source.slice(start, index).trim())
        start = index + 1
      }
    }

    if (quote !== undefined) return undefined
    parts.push(source.slice(start).trim())
    return parts.every((part) => part.length > 0) ? parts : undefined
  }

  const splitTopLevel = (source: string, separator: string): string[] | undefined => {
    const parts: string[] = []
    let quote: '"' | "'" | undefined
    let depth = 0
    let start = 0

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]
      if (character === undefined) return undefined
      if (character === "\\") return undefined

      if (quote !== undefined) {
        if (character === quote) quote = undefined
        continue
      }

      if (character === '"' || character === "'") {
        quote = character
        continue
      }

      if (character === "(" || character === "[" || character === "{") {
        depth += 1
        continue
      }

      if (character === ")" || character === "]" || character === "}") {
        depth -= 1
        if (depth < 0) return undefined
        continue
      }

      if (character === separator && depth === 0) {
        parts.push(source.slice(start, index).trim())
        start = index + 1
      }
    }

    if (quote !== undefined || depth !== 0) return undefined
    parts.push(source.slice(start).trim())
    return parts.every((part) => part.length > 0) ? parts : undefined
  }

  const splitKeyValue = (entry: string): readonly [string, string] | undefined => {
    const parts = splitOutsideQuotes(entry, ":")
    return parts?.length === 2 && parts[0] !== undefined && parts[1] !== undefined
      ? [parts[0], parts[1]]
      : undefined
  }

  const splitComparison = (source: string): readonly [string, "==" | "!=", string] | undefined => {
    let quote: '"' | "'" | undefined

    for (let index = 0; index < source.length - 1; index += 1) {
      const character = source[index]
      if (character === undefined) return undefined
      if (character === "\\") return undefined

      if (quote !== undefined) {
        if (character === quote) quote = undefined
        continue
      }

      if (character === '"' || character === "'") {
        quote = character
        continue
      }

      const operator = source.slice(index, index + 2)
      if (operator === "==" || operator === "!=") {
        const left = source.slice(0, index).trim()
        const right = source.slice(index + 2).trim()
        return left.length > 0 && right.length > 0 ? [left, operator, right] : undefined
      }
    }

    return undefined
  }

  const stringLiteralValue = (value: string): string | typeof invalid => {
    const source = value.trim()
    return stringLiteralPattern.test(source) ? source.slice(1, -1) : invalid
  }

  const objectKeyName = (value: string): string | typeof invalid => {
    const source = value.trim()
    if (bareIdentifierPattern.test(source)) return source

    const literal = stringLiteralValue(source)
    return literal !== invalid && bareIdentifierPattern.test(literal) ? literal : invalid
  }

  const isCapabilityName = (value: string): boolean => capabilityNamePattern.test(value)
  const isStateName = (value: string): boolean => bareIdentifierPattern.test(value)
  const isStatePath = (value: string): boolean => statePathPattern.test(value)
  const statePathParts = (value: string): readonly string[] | undefined => {
    const source = value.startsWith("$") ? value.slice(1) : value
    const parts = source.split(".")
    return parts.length > 0 && parts.every(isStateName) ? parts : undefined
  }

  const parseScalarExpression = (
    source: string,
    readState: (expression: string) => unknown,
  ): unknown => {
    const value = source.trim()
    if (stringLiteralPattern.test(value)) return value.slice(1, -1)
    if (numberLiteralPattern.test(value)) return Number(value)
    if (value === "true") return true
    if (value === "false") return false
    if (value === "null") return null
    if (statePathPattern.test(value)) return readState(value)
    return invalid
  }

  const isSafeScalarExpression = (value: string): boolean =>
    parseScalarExpression(value, () => "") !== invalid

  const parseObjectLiteral = (
    source: string,
    readState: (expression: string) => unknown,
  ): unknown => {
    const value = source.trim()
    if (!value.startsWith("{") || !value.endsWith("}")) return invalid

    const body = value.slice(1, -1).trim()
    if (body.length === 0) return {}

    const entries = splitOutsideQuotes(body, ",")
    if (entries === undefined) return invalid

    const output: Record<string, unknown> = {}
    for (const entry of entries) {
      const keyValue = splitKeyValue(entry)
      if (keyValue === undefined) return invalid

      const key = objectKeyName(keyValue[0])
      if (key === invalid) return invalid

      const parsedValue = parseScalarExpression(keyValue[1], readState)
      if (parsedValue === invalid) return invalid
      output[key] = parsedValue
    }

    return output
  }

  const isSafeObjectExpression = (value: string): boolean =>
    parseObjectLiteral(value, () => "") !== invalid

  const evaluateExpression = (
    source: string,
    readState: (expression: string) => unknown,
  ): unknown => {
    const value = source.trim()
    const comparison = splitComparison(value)
    if (comparison !== undefined) {
      const left = parseScalarExpression(comparison[0], readState)
      const right = parseScalarExpression(comparison[2], readState)
      if (left === invalid || right === invalid) return invalid
      return comparison[1] === "==" ? Object.is(left, right) : !Object.is(left, right)
    }

    const scalar = parseScalarExpression(value, readState)
    if (scalar !== invalid) return scalar

    return parseObjectLiteral(value, readState)
  }

  const isSafeSimpleExpression = (value: string): boolean =>
    value.length <= 1_200 && evaluateExpression(value, () => "") !== invalid

  const isSafeBindingExpression = (value: string): boolean => {
    const source = value.trim()
    return source.length <= 1_200 && (isStateName(source) || isStatePath(source))
  }

  const parseTargetOptions = (value: string): string | undefined => {
    const source = value.trim()
    if (!source.startsWith("{") || !source.endsWith("}")) return undefined

    const body = source.slice(1, -1).trim()
    if (body.length === 0) return undefined

    const entries = splitOutsideQuotes(body, ",")
    if (entries === undefined || entries.length !== 1) return undefined

    const keyValue = splitKeyValue(entries[0])
    if (keyValue === undefined) return undefined

    const [key, target] = keyValue
    const targetValue = stringLiteralValue(target)
    return objectKeyName(key) === "target" && targetValue !== invalid && isStateName(targetValue)
      ? targetValue
      : undefined
  }

  const parseCapabilityAction = (value: string): Genui0CapabilityAction | undefined => {
    const source = value.trim()
    const prefix = "@capability("
    if (!source.startsWith(prefix) || !source.endsWith(")")) return undefined

    const args = splitTopLevel(source.slice(prefix.length, -1), ",")
    if (args === undefined || (args.length !== 2 && args.length !== 3)) return undefined

    const capability = stringLiteralValue(args[0])
    const inputExpression = args[1]

    if (
      capability === invalid ||
      inputExpression === undefined ||
      !isCapabilityName(capability) ||
      !isSafeObjectExpression(inputExpression)
    ) {
      return undefined
    }

    if (args[2] === undefined) return { capability, inputExpression }

    const target = parseTargetOptions(args[2])
    return target === undefined ? undefined : { capability, inputExpression, target }
  }

  const parseCapabilityExpression = (
    expression: string,
    readState: (expression: string) => unknown,
  ): Genui0SandboxCapabilityAction | undefined => {
    const action = parseCapabilityAction(expression)
    if (action === undefined) return undefined

    const input = parseObjectLiteral(action.inputExpression, readState)
    if (input === invalid) return undefined

    return action.target === undefined
      ? { capability: action.capability, input }
      : { capability: action.capability, input, target: action.target }
  }

  const parseSetAction = (value: string): Genui0SetAction | undefined => {
    const source = value.trim()
    const prefix = "@set("
    if (!source.startsWith(prefix) || !source.endsWith(")")) return undefined

    const args = splitTopLevel(source.slice(prefix.length, -1), ",")
    if (args === undefined || args.length !== 2) return undefined

    const pathExpression = stringLiteralValue(args[0])
    const valueExpression = args[1]
    if (
      pathExpression === invalid ||
      valueExpression === undefined ||
      statePathParts(pathExpression) === undefined ||
      !isSafeSimpleExpression(valueExpression)
    ) {
      return undefined
    }

    return { pathExpression, valueExpression }
  }

  const parseSetExpression = (
    expression: string,
    readState: (expression: string) => unknown,
  ): Genui0SandboxSetAction | undefined => {
    const action = parseSetAction(expression)
    if (action === undefined) return undefined

    const path = statePathParts(action.pathExpression)
    if (path === undefined) return undefined

    const value = evaluateExpression(action.valueExpression, readState)
    return value === invalid ? undefined : { path, value }
  }

  const camelCaseWords = (words: readonly string[]): string => {
    const [first, ...rest] = words
    if (first === undefined) return "capability"

    return [
      first.toLowerCase(),
      ...rest.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`),
    ].join("")
  }

  const defaultResultTarget = (capability: string): string => {
    const words = capability.split(/[._-]+/).filter((part) => part.length > 0)
    const target = camelCaseWords(words)
    return isStateName(target) ? target : "capability"
  }

  const normalizeResultTarget = (target: string | undefined, capability: string): string =>
    target !== undefined && isStateName(target) ? target : defaultResultTarget(capability)

  return {
    invalid,
    isCapabilityName,
    isStateName,
    isStatePath,
    isSafeScalarExpression,
    isSafeObjectExpression,
    isSafeSimpleExpression,
    isSafeBindingExpression,
    parseCapabilityAction,
    parseSetAction,
    parseObjectLiteral,
    evaluateExpression,
    parseCapabilityExpression,
    parseSetExpression,
    defaultResultTarget,
    normalizeResultTarget,
  }
}

const genui0Language = createGenui0Language()

/** Return whether a string is a valid genui/0 capability name. */
export const isGenui0CapabilityName = (value: string): boolean =>
  genui0Language.isCapabilityName(value)

/** Return whether a flat object expression belongs to the genui/0 closed expression subset. */
export const isSafeGenui0ObjectExpression = (value: string): boolean =>
  genui0Language.isSafeObjectExpression(value)

/** Return whether an ordinary local expression belongs to the genui/0 subset. */
export const isSafeGenui0SimpleExpression = (value: string): boolean =>
  genui0Language.isSafeSimpleExpression(value)

/** Return whether a data-genui-bind expression belongs to the genui/0 subset. */
export const isSafeGenui0BindingExpression = (value: string): boolean =>
  genui0Language.isSafeBindingExpression(value)

/** Parse a v0 @capability action only when its input and target syntax are in the dialect. */
export const parseGenui0CapabilityAction = (value: string): Genui0CapabilityAction | undefined =>
  genui0Language.parseCapabilityAction(value)

/** Parse a v0 local @set action only when its path and value syntax are in the dialect. */
export const parseGenui0SetAction = (value: string): Genui0SetAction | undefined =>
  genui0Language.parseSetAction(value)

/** Convert a capability name into the default genui/0 result state target. */
export const defaultGenui0ResultTarget = (capability: string): string =>
  genui0Language.defaultResultTarget(capability)

/** Keep model-authored result target names inside the genui/0 state-name subset. */
export const normalizeGenui0ResultTarget = (
  target: string | undefined,
  capability: string,
): string => genui0Language.normalizeResultTarget(target, capability)

/** Build the sandbox-language parser source used by the injected genui/0 bridge. */
export const genui0SandboxLanguageScript = (): string => `
  const genui0Language = (${createGenui0Language.toString()})();
  const genui0Invalid = genui0Language.invalid;
  const genui0ParseObjectLiteral = genui0Language.parseObjectLiteral;
  const genui0EvaluateExpression = genui0Language.evaluateExpression;
  const genui0DefaultResultTarget = genui0Language.defaultResultTarget;
  const parseGenui0CapabilityExpression = genui0Language.parseCapabilityExpression;
  const parseGenui0SetExpression = genui0Language.parseSetExpression;
`
