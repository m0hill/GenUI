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

type Punctuation = "{" | "}" | "(" | ")" | "," | ":"
type EqualityOperator = "==" | "!="
type OrderingOperator = "<" | "<=" | ">" | ">="
type LogicalOperator = "&&" | "||"
type UnaryOperator = "!"
type BinaryOperator = EqualityOperator | OrderingOperator | LogicalOperator
type FormatterName = "formatNumber" | "formatCurrency" | "formatPercent" | "formatDate"

type Token =
  | {
      readonly type: "handler"
      readonly value: string
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "identifier"
      readonly value: string
      readonly start: number
      readonly end: number
    }
  | { readonly type: "state"; readonly value: string; readonly start: number; readonly end: number }
  | {
      readonly type: "string"
      readonly value: string
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "number"
      readonly value: number
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "keyword"
      readonly value: "true" | "false" | "null"
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "punctuation"
      readonly value: Punctuation
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "operator"
      readonly value: BinaryOperator | UnaryOperator
      readonly start: number
      readonly end: number
    }

type ScalarExpression =
  | {
      readonly type: "string"
      readonly value: string
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "number"
      readonly value: number
      readonly start: number
      readonly end: number
    }
  | {
      readonly type: "boolean"
      readonly value: boolean
      readonly start: number
      readonly end: number
    }
  | { readonly type: "null"; readonly start: number; readonly end: number }
  | { readonly type: "state"; readonly path: string; readonly start: number; readonly end: number }

type ObjectEntry = {
  readonly key: string
  readonly value: ScalarExpression
}

type ObjectExpression = {
  readonly type: "object"
  readonly entries: readonly ObjectEntry[]
  readonly start: number
  readonly end: number
}

type FormatterExpression = {
  readonly type: "formatter"
  readonly name: FormatterName
  readonly args: readonly ValueExpression[]
  readonly start: number
  readonly end: number
}

type UnaryExpression = {
  readonly type: "unary"
  readonly operator: UnaryOperator
  readonly expression: ValueExpression
  readonly start: number
  readonly end: number
}

type BinaryExpression = {
  readonly type: "binary"
  readonly operator: BinaryOperator
  readonly left: ValueExpression
  readonly right: ValueExpression
  readonly start: number
  readonly end: number
}

type GroupExpression = {
  readonly type: "group"
  readonly expression: ValueExpression
  readonly start: number
  readonly end: number
}

type ValueExpression =
  | ScalarExpression
  | FormatterExpression
  | UnaryExpression
  | BinaryExpression
  | GroupExpression

type Expression = ValueExpression | ObjectExpression

/** Build the genui/0 expression grammar used by sanitizer checks and the sandbox runtime. */
const createGenui0Language = (): Genui0Language => {
  const capabilityNamePatternSource = "[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+"
  const bareIdentifierPatternSource = "_?[A-Za-z][A-Za-z0-9_]*"
  const statePathPatternSource = "\\$_?[A-Za-z][A-Za-z0-9_]*(?:\\._?[A-Za-z][A-Za-z0-9_]*)*"
  const numberPrefixPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?/

  const exactPattern = (source: string, flags?: string): RegExp => new RegExp(`^${source}$`, flags)

  const capabilityNamePattern = exactPattern(capabilityNamePatternSource, "i")
  const bareIdentifierPattern = exactPattern(bareIdentifierPatternSource)
  const statePathPattern = exactPattern(statePathPatternSource)
  const invalid = Symbol("genui0.invalid")
  const formatterArity: Readonly<Record<FormatterName, number>> = Object.freeze({
    formatNumber: 1,
    formatCurrency: 2,
    formatPercent: 1,
    formatDate: 1,
  })
  const formatterNames = new Set<FormatterName>([
    "formatNumber",
    "formatCurrency",
    "formatPercent",
    "formatDate",
  ])

  const isWhitespace = (character: string): boolean =>
    character === " " || character === "\n" || character === "\r" || character === "\t"

  const isIdentifierStart = (character: string | undefined): boolean =>
    character !== undefined && /[A-Za-z]/.test(character)

  const isIdentifierPart = (character: string | undefined): boolean =>
    character !== undefined && /[A-Za-z0-9_]/.test(character)

  const readIdentifier = (
    source: string,
    start: number,
  ): { readonly value: string; readonly end: number } | undefined => {
    let index = start
    if (source[index] === "_") {
      const next = source[index + 1]
      if (!isIdentifierStart(next)) return undefined
      index += 2
    } else {
      if (!isIdentifierStart(source[index])) return undefined
      index += 1
    }

    while (isIdentifierPart(source[index])) index += 1
    return { value: source.slice(start, index), end: index }
  }

  const readStatePath = (
    source: string,
    start: number,
  ): { readonly value: string; readonly end: number } | undefined => {
    let index = start + 1
    const first = readIdentifier(source, index)
    if (first === undefined) return undefined
    index = first.end

    while (source[index] === ".") {
      const next = readIdentifier(source, index + 1)
      if (next === undefined) return undefined
      index = next.end
    }

    return { value: source.slice(start, index), end: index }
  }

  const tokenize = (source: string): readonly Token[] | undefined => {
    const tokens: Token[] = []
    let index = 0

    while (index < source.length) {
      const character = source[index]
      if (character === undefined) return undefined

      if (isWhitespace(character)) {
        index += 1
        continue
      }

      if (character === "\\") return undefined

      if (character === "'" || character === '"') {
        const quote = character
        const start = index
        index += 1
        let value = ""
        let closed = false

        while (index < source.length) {
          const current = source[index]
          if (current === undefined || current === "\\" || current === "<" || current === ">") {
            return undefined
          }
          if (current === quote) {
            index += 1
            tokens.push({ type: "string", value, start, end: index })
            closed = true
            break
          }
          value += current
          index += 1
        }

        if (!closed) return undefined
        continue
      }

      if (character === "@") {
        const identifier = readIdentifier(source, index + 1)
        if (identifier === undefined) return undefined
        tokens.push({
          type: "handler",
          value: identifier.value,
          start: index,
          end: identifier.end,
        })
        index = identifier.end
        continue
      }

      if (character === "$") {
        const path = readStatePath(source, index)
        if (path === undefined) return undefined
        tokens.push({ type: "state", value: path.value, start: index, end: path.end })
        index = path.end
        continue
      }

      if (character === "-" || /\d/.test(character)) {
        const match = numberPrefixPattern.exec(source.slice(index))
        if (match === null || match.index !== 0) return undefined
        const value = match[0]
        tokens.push({
          type: "number",
          value: Number(value),
          start: index,
          end: index + value.length,
        })
        index += value.length
        continue
      }

      if (isIdentifierStart(character) || character === "_") {
        const identifier = readIdentifier(source, index)
        if (identifier === undefined) return undefined
        if (
          identifier.value === "true" ||
          identifier.value === "false" ||
          identifier.value === "null"
        ) {
          tokens.push({
            type: "keyword",
            value: identifier.value,
            start: index,
            end: identifier.end,
          })
        } else {
          tokens.push({
            type: "identifier",
            value: identifier.value,
            start: index,
            end: identifier.end,
          })
        }
        index = identifier.end
        continue
      }

      const operator = source.slice(index, index + 2)
      if (
        operator === "==" ||
        operator === "!=" ||
        operator === "<=" ||
        operator === ">=" ||
        operator === "&&" ||
        operator === "||"
      ) {
        tokens.push({
          type: "operator",
          value: operator,
          start: index,
          end: index + 2,
        })
        index += 2
        continue
      }

      if (character === "<" || character === ">" || character === "!") {
        tokens.push({
          type: "operator",
          value: character,
          start: index,
          end: index + 1,
        })
        index += 1
        continue
      }

      if (
        character === "{" ||
        character === "}" ||
        character === "(" ||
        character === ")" ||
        character === "," ||
        character === ":"
      ) {
        tokens.push({
          type: "punctuation",
          value: character,
          start: index,
          end: index + 1,
        })
        index += 1
        continue
      }

      return undefined
    }

    return tokens
  }

  const isCapabilityName = (value: string): boolean => capabilityNamePattern.test(value)
  const isStateName = (value: string): boolean => bareIdentifierPattern.test(value)
  const isStatePath = (value: string): boolean => statePathPattern.test(value)
  const statePathParts = (value: string): readonly string[] | undefined => {
    const source = value.startsWith("$") ? value.slice(1) : value
    const parts = source.split(".")
    return parts.length > 0 && parts.every(isStateName) ? parts : undefined
  }
  const formatterName = (value: string): FormatterName | undefined =>
    formatterNames.has(value as FormatterName) ? (value as FormatterName) : undefined

  const tokenAt = (tokens: readonly Token[], index: number): Token | undefined => tokens[index]

  const parseScalar = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ScalarExpression; readonly next: number } | undefined => {
    const token = tokenAt(tokens, index)
    if (token === undefined) return undefined

    if (token.type === "string") {
      return {
        expression: { type: "string", value: token.value, start: token.start, end: token.end },
        next: index + 1,
      }
    }

    if (token.type === "number") {
      return {
        expression: { type: "number", value: token.value, start: token.start, end: token.end },
        next: index + 1,
      }
    }

    if (token.type === "keyword") {
      if (token.value === "null") {
        return { expression: { type: "null", start: token.start, end: token.end }, next: index + 1 }
      }

      return {
        expression: {
          type: "boolean",
          value: token.value === "true",
          start: token.start,
          end: token.end,
        },
        next: index + 1,
      }
    }

    if (token.type === "state") {
      return {
        expression: { type: "state", path: token.value, start: token.start, end: token.end },
        next: index + 1,
      }
    }

    return undefined
  }

  const parseObject = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ObjectExpression; readonly next: number } | undefined => {
    const open = tokenAt(tokens, index)
    if (open?.type !== "punctuation" || open.value !== "{") return undefined

    const entries: ObjectEntry[] = []
    let cursor = index + 1
    const first = tokenAt(tokens, cursor)
    if (first?.type === "punctuation" && first.value === "}") {
      return {
        expression: { type: "object", entries, start: open.start, end: first.end },
        next: cursor + 1,
      }
    }

    while (cursor < tokens.length) {
      const key = tokenAt(tokens, cursor)
      let keyName: string | undefined
      if (key?.type === "identifier") keyName = key.value
      if (key?.type === "string" && isStateName(key.value)) keyName = key.value
      if (keyName === undefined) return undefined
      cursor += 1

      const colon = tokenAt(tokens, cursor)
      if (colon?.type !== "punctuation" || colon.value !== ":") return undefined
      cursor += 1

      const value = parseScalar(tokens, cursor)
      if (value === undefined) return undefined
      entries.push({ key: keyName, value: value.expression })
      cursor = value.next

      const separator = tokenAt(tokens, cursor)
      if (separator?.type === "punctuation" && separator.value === ",") {
        cursor += 1
        const next = tokenAt(tokens, cursor)
        if (next === undefined || (next.type === "punctuation" && next.value === "}")) {
          return undefined
        }
        continue
      }

      if (separator?.type === "punctuation" && separator.value === "}") {
        return {
          expression: { type: "object", entries, start: open.start, end: separator.end },
          next: cursor + 1,
        }
      }

      return undefined
    }

    return undefined
  }

  const parseFormatter = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: FormatterExpression; readonly next: number } | undefined => {
    const name = tokenAt(tokens, index)
    const open = tokenAt(tokens, index + 1)
    if (name?.type !== "identifier" || open?.type !== "punctuation" || open.value !== "(") {
      return undefined
    }

    const formatter = formatterName(name.value)
    if (formatter === undefined) return undefined

    const args: ValueExpression[] = []
    let cursor = index + 2
    const first = tokenAt(tokens, cursor)
    if (first?.type === "punctuation" && first.value === ")") {
      return formatterArity[formatter] === 0
        ? {
            expression: {
              type: "formatter",
              name: formatter,
              args,
              start: name.start,
              end: first.end,
            },
            next: cursor + 1,
          }
        : undefined
    }

    while (cursor < tokens.length) {
      const arg = parseOr(tokens, cursor)
      if (arg === undefined) return undefined
      args.push(arg.expression)
      cursor = arg.next

      const separator = tokenAt(tokens, cursor)
      if (separator?.type === "punctuation" && separator.value === ",") {
        cursor += 1
        const next = tokenAt(tokens, cursor)
        if (next === undefined || (next.type === "punctuation" && next.value === ")")) {
          return undefined
        }
        continue
      }

      if (separator?.type === "punctuation" && separator.value === ")") {
        return args.length === formatterArity[formatter]
          ? {
              expression: {
                type: "formatter",
                name: formatter,
                args,
                start: name.start,
                end: separator.end,
              },
              next: cursor + 1,
            }
          : undefined
      }

      return undefined
    }

    return undefined
  }

  const parsePrimary = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ValueExpression; readonly next: number } | undefined => {
    const scalar = parseScalar(tokens, index)
    if (scalar !== undefined) return scalar

    const formatter = parseFormatter(tokens, index)
    if (formatter !== undefined) return formatter

    const open = tokenAt(tokens, index)
    if (open?.type !== "punctuation" || open.value !== "(") return undefined

    const expression = parseOr(tokens, index + 1)
    if (expression === undefined) return undefined

    const close = tokenAt(tokens, expression.next)
    return close?.type === "punctuation" && close.value === ")"
      ? {
          expression: {
            type: "group",
            expression: expression.expression,
            start: open.start,
            end: close.end,
          },
          next: expression.next + 1,
        }
      : undefined
  }

  const parseUnary = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ValueExpression; readonly next: number } | undefined => {
    const operator = tokenAt(tokens, index)
    if (operator?.type === "operator" && operator.value === "!") {
      const expression = parseUnary(tokens, index + 1)
      return expression === undefined
        ? undefined
        : {
            expression: {
              type: "unary",
              operator: "!",
              expression: expression.expression,
              start: operator.start,
              end: expression.expression.end,
            },
            next: expression.next,
          }
    }

    return parsePrimary(tokens, index)
  }

  const parseComparison = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ValueExpression; readonly next: number } | undefined => {
    const left = parseUnary(tokens, index)
    if (left === undefined) return undefined

    const operator = tokenAt(tokens, left.next)
    if (
      operator?.type !== "operator" ||
      (operator.value !== "==" &&
        operator.value !== "!=" &&
        operator.value !== "<" &&
        operator.value !== "<=" &&
        operator.value !== ">" &&
        operator.value !== ">=")
    ) {
      return left
    }

    const right = parseUnary(tokens, left.next + 1)
    return right === undefined
      ? undefined
      : {
          expression: {
            type: "binary",
            operator: operator.value,
            left: left.expression,
            right: right.expression,
            start: left.expression.start,
            end: right.expression.end,
          },
          next: right.next,
        }
  }

  const parseAnd = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ValueExpression; readonly next: number } | undefined => {
    let parsed = parseComparison(tokens, index)
    if (parsed === undefined) return undefined

    let operator = tokenAt(tokens, parsed.next)
    while (operator?.type === "operator" && operator.value === "&&") {
      const right = parseComparison(tokens, parsed.next + 1)
      if (right === undefined) return undefined
      parsed = {
        expression: {
          type: "binary",
          operator: "&&",
          left: parsed.expression,
          right: right.expression,
          start: parsed.expression.start,
          end: right.expression.end,
        },
        next: right.next,
      }
      operator = tokenAt(tokens, parsed.next)
    }

    return parsed
  }

  const parseOr = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: ValueExpression; readonly next: number } | undefined => {
    let parsed = parseAnd(tokens, index)
    if (parsed === undefined) return undefined

    let operator = tokenAt(tokens, parsed.next)
    while (operator?.type === "operator" && operator.value === "||") {
      const right = parseAnd(tokens, parsed.next + 1)
      if (right === undefined) return undefined
      parsed = {
        expression: {
          type: "binary",
          operator: "||",
          left: parsed.expression,
          right: right.expression,
          start: parsed.expression.start,
          end: right.expression.end,
        },
        next: right.next,
      }
      operator = tokenAt(tokens, parsed.next)
    }

    return parsed
  }

  const parseExpression = (
    tokens: readonly Token[],
    index: number,
  ): { readonly expression: Expression; readonly next: number } | undefined => {
    return parseOr(tokens, index) ?? parseObject(tokens, index)
  }

  const parseFullScalar = (source: string): ScalarExpression | undefined => {
    const tokens = tokenize(source)
    if (tokens === undefined) return undefined
    const parsed = parseScalar(tokens, 0)
    return parsed !== undefined && parsed.next === tokens.length ? parsed.expression : undefined
  }

  const parseFullObject = (source: string): ObjectExpression | undefined => {
    const tokens = tokenize(source)
    if (tokens === undefined) return undefined
    const parsed = parseObject(tokens, 0)
    return parsed !== undefined && parsed.next === tokens.length ? parsed.expression : undefined
  }

  const parseFullExpression = (source: string): Expression | undefined => {
    const tokens = tokenize(source)
    if (tokens === undefined) return undefined
    const parsed = parseExpression(tokens, 0)
    return parsed !== undefined && parsed.next === tokens.length ? parsed.expression : undefined
  }

  const evaluateScalar = (
    expression: ScalarExpression,
    readState: (expression: string) => unknown,
  ): unknown => {
    switch (expression.type) {
      case "string":
      case "number":
      case "boolean":
        return expression.value
      case "null":
        return null
      case "state":
        return readState(expression.path)
    }
  }

  const isTruthy = (value: unknown): boolean =>
    value !== invalid &&
    value !== false &&
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== 0

  const finiteNumber = (value: unknown): number | undefined => {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined
    if (typeof value !== "string") return undefined

    const source = value.trim()
    if (source.length === 0) return undefined

    const parsed = Number(source)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const currencyCode = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const code = value.trim().toUpperCase()
    return /^[A-Z]{3}$/.test(code) ? code : undefined
  }

  const dateValue = (value: unknown): Date | undefined => {
    if (typeof value !== "string" && typeof value !== "number") return undefined
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : undefined
  }

  const formatNumber = (value: unknown): string | typeof invalid => {
    const number = finiteNumber(value)
    return number === undefined
      ? invalid
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
  }

  const formatCurrency = (value: unknown, currency: unknown): string | typeof invalid => {
    const number = finiteNumber(value)
    const code = currencyCode(currency)
    return number === undefined || code === undefined
      ? invalid
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: code,
        }).format(number)
  }

  const formatPercent = (value: unknown): string | typeof invalid => {
    const number = finiteNumber(value)
    return number === undefined
      ? invalid
      : new Intl.NumberFormat("en-US", {
          style: "percent",
          maximumFractionDigits: 1,
        }).format(number)
  }

  const formatDate = (value: unknown): string | typeof invalid => {
    const date = dateValue(value)
    return date === undefined
      ? invalid
      : new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(date)
  }

  const compareOrdered = (
    operator: OrderingOperator,
    left: unknown,
    right: unknown,
  ): boolean | typeof invalid => {
    if (typeof left === "number" && typeof right === "number") {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return invalid
      if (operator === "<") return left < right
      if (operator === "<=") return left <= right
      if (operator === ">") return left > right
      return left >= right
    }

    if (typeof left === "string" && typeof right === "string") {
      if (operator === "<") return left < right
      if (operator === "<=") return left <= right
      if (operator === ">") return left > right
      return left >= right
    }

    return invalid
  }

  const evaluateValue = (
    expression: ValueExpression,
    readState: (expression: string) => unknown,
  ): unknown => {
    switch (expression.type) {
      case "string":
      case "number":
      case "boolean":
      case "null":
      case "state":
        return evaluateScalar(expression, readState)
      case "group":
        return evaluateValue(expression.expression, readState)
      case "unary":
        return !isTruthy(evaluateValue(expression.expression, readState))
      case "formatter": {
        const args = expression.args.map((arg) => evaluateValue(arg, readState))
        if (expression.name === "formatNumber") return formatNumber(args[0])
        if (expression.name === "formatCurrency") return formatCurrency(args[0], args[1])
        if (expression.name === "formatPercent") return formatPercent(args[0])
        return formatDate(args[0])
      }
      case "binary": {
        if (expression.operator === "&&") {
          const left = evaluateValue(expression.left, readState)
          return isTruthy(left) ? evaluateValue(expression.right, readState) : left
        }
        if (expression.operator === "||") {
          const left = evaluateValue(expression.left, readState)
          return isTruthy(left) ? left : evaluateValue(expression.right, readState)
        }

        const left = evaluateValue(expression.left, readState)
        const right = evaluateValue(expression.right, readState)
        if (expression.operator === "==") return Object.is(left, right)
        if (expression.operator === "!=") return !Object.is(left, right)
        return compareOrdered(expression.operator, left, right)
      }
    }
  }

  const evaluateObject = (
    expression: ObjectExpression,
    readState: (expression: string) => unknown,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = {}
    for (const entry of expression.entries) {
      output[entry.key] = evaluateScalar(entry.value, readState)
    }
    return output
  }

  const evaluate = (
    expression: Expression,
    readState: (expression: string) => unknown,
  ): unknown => {
    return expression.type === "object"
      ? evaluateObject(expression, readState)
      : evaluateValue(expression, readState)
  }

  const sourceFor = (
    source: string,
    expression: { readonly start: number; readonly end: number },
  ): string => source.slice(expression.start, expression.end).trim()

  const isSafeScalarExpression = (value: string): boolean => parseFullScalar(value) !== undefined

  const parseObjectLiteral = (
    source: string,
    readState: (expression: string) => unknown,
  ): unknown => {
    const parsed = parseFullObject(source)
    return parsed === undefined ? invalid : evaluateObject(parsed, readState)
  }

  const isSafeObjectExpression = (value: string): boolean => parseFullObject(value) !== undefined

  const evaluateExpression = (
    source: string,
    readState: (expression: string) => unknown,
  ): unknown => {
    const parsed = parseFullExpression(source)
    return parsed === undefined ? invalid : evaluate(parsed, readState)
  }

  const isSafeSimpleExpression = (value: string): boolean =>
    value.length <= 1_200 && parseFullExpression(value) !== undefined

  const isSafeBindingExpression = (value: string): boolean => {
    const source = value.trim()
    return source.length <= 1_200 && statePathParts(source) !== undefined
  }

  const parseTargetOptions = (source: string, expression: ObjectExpression): string | undefined => {
    const parsed = parseFullObject(sourceFor(source, expression))
    const entry = parsed?.entries[0]
    if (parsed === undefined || parsed.entries.length !== 1 || entry === undefined) return undefined
    return entry.key === "target" && entry.value.type === "string" && isStateName(entry.value.value)
      ? entry.value.value
      : undefined
  }

  const parseCapabilityAction = (value: string): Genui0CapabilityAction | undefined => {
    const source = value.trim()
    const tokens = tokenize(source)
    if (tokens === undefined) return undefined

    let cursor = 0
    const handler = tokenAt(tokens, cursor)
    if (
      handler?.type !== "handler" ||
      (handler.value !== "action" && handler.value !== "capability")
    ) {
      return undefined
    }
    cursor += 1

    const open = tokenAt(tokens, cursor)
    if (open?.type !== "punctuation" || open.value !== "(" || handler.end !== open.start) {
      return undefined
    }
    cursor += 1

    const capabilityToken = tokenAt(tokens, cursor)
    if (capabilityToken?.type !== "string" || !isCapabilityName(capabilityToken.value)) {
      return undefined
    }
    cursor += 1

    const inputSeparator = tokenAt(tokens, cursor)
    if (inputSeparator?.type !== "punctuation" || inputSeparator.value !== ",") return undefined
    cursor += 1

    const input = parseObject(tokens, cursor)
    if (input === undefined) return undefined
    cursor = input.next

    const next = tokenAt(tokens, cursor)
    if (next?.type === "punctuation" && next.value === ")") {
      return next === tokens.at(-1)
        ? {
            capability: capabilityToken.value,
            inputExpression: sourceFor(source, input.expression),
          }
        : undefined
    }

    if (next?.type !== "punctuation" || next.value !== ",") return undefined
    cursor += 1

    const options = parseObject(tokens, cursor)
    if (options === undefined) return undefined
    cursor = options.next

    const close = tokenAt(tokens, cursor)
    if (close?.type !== "punctuation" || close.value !== ")" || cursor !== tokens.length - 1) {
      return undefined
    }

    const target = parseTargetOptions(source, options.expression)
    return target === undefined
      ? undefined
      : {
          capability: capabilityToken.value,
          inputExpression: sourceFor(source, input.expression),
          target,
        }
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
    const tokens = tokenize(source)
    if (tokens === undefined) return undefined

    let cursor = 0
    const handler = tokenAt(tokens, cursor)
    if (handler?.type !== "handler" || handler.value !== "set") return undefined
    cursor += 1

    const open = tokenAt(tokens, cursor)
    if (open?.type !== "punctuation" || open.value !== "(" || handler.end !== open.start) {
      return undefined
    }
    cursor += 1

    const path = tokenAt(tokens, cursor)
    if (path?.type !== "string" || statePathParts(path.value) === undefined) return undefined
    cursor += 1

    const separator = tokenAt(tokens, cursor)
    if (separator?.type !== "punctuation" || separator.value !== ",") return undefined
    cursor += 1

    const expression = parseExpression(tokens, cursor)
    if (expression === undefined) return undefined
    cursor = expression.next

    const close = tokenAt(tokens, cursor)
    if (close?.type !== "punctuation" || close.value !== ")" || cursor !== tokens.length - 1) {
      return undefined
    }

    return {
      pathExpression: path.value,
      valueExpression: sourceFor(source, expression.expression),
    }
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

/** Shared genui/0 language object used by sanitizer checks and the sandbox runtime. */
export const genui0Language = createGenui0Language()
