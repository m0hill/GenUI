const capabilityNamePatternSource = "[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+"
const bareIdentifierPatternSource = "_?[A-Za-z][A-Za-z0-9_]*"
const signalPathPatternSource = "\\$_?[A-Za-z][A-Za-z0-9_]*(?:\\._?[A-Za-z][A-Za-z0-9_]*)*"
const numberLiteralPatternSource = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"
const stringLiteralPatternSource = `(?:"[^"\\\\<>]*"|'[^'\\\\<>]*')`
const primitiveLiteralPatternSource = "(?:true|false|null)"

const exactPattern = (source: string, flags?: string): RegExp => new RegExp(`^${source}$`, flags)

const capabilityNamePattern = exactPattern(capabilityNamePatternSource, "i")
const bareIdentifierPattern = exactPattern(bareIdentifierPatternSource)
const signalPathPattern = exactPattern(signalPathPatternSource)
const numberLiteralPattern = exactPattern(numberLiteralPatternSource)
const stringLiteralPattern = exactPattern(stringLiteralPatternSource)
const primitiveLiteralPattern = exactPattern(primitiveLiteralPatternSource)

export interface Genui0CapabilityAction {
  readonly capability: string
  readonly inputExpression: string
  readonly target?: string
}

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

const stringLiteralValue = (value: string): string | undefined =>
  stringLiteralPattern.test(value.trim()) ? value.trim().slice(1, -1) : undefined

const objectKeyName = (value: string): string | undefined => {
  const source = value.trim()
  if (bareIdentifierPattern.test(source)) return source

  const literal = stringLiteralValue(source)
  return literal !== undefined && bareIdentifierPattern.test(literal) ? literal : undefined
}

/** Return whether a string is a valid genui/0 capability name. */
export const isGenui0CapabilityName = (value: string): boolean => capabilityNamePattern.test(value)

/** Return whether a string is a valid genui/0 signal/result target name. */
export const isGenui0SignalName = (value: string): boolean => bareIdentifierPattern.test(value)

/** Return whether a string is a valid genui/0 signal read path. */
export const isGenui0SignalPath = (value: string): boolean => signalPathPattern.test(value)

/** Return whether a scalar expression belongs to the genui/0 closed expression subset. */
export const isSafeGenui0ScalarExpression = (value: string): boolean => {
  const source = value.trim()
  return (
    signalPathPattern.test(source) ||
    numberLiteralPattern.test(source) ||
    primitiveLiteralPattern.test(source) ||
    stringLiteralPattern.test(source)
  )
}

/** Return whether a flat object expression belongs to the genui/0 closed expression subset. */
export const isSafeGenui0ObjectExpression = (value: string): boolean => {
  const source = value.trim()
  if (!source.startsWith("{") || !source.endsWith("}")) return false

  const body = source.slice(1, -1).trim()
  if (body.length === 0) return true

  const entries = splitOutsideQuotes(body, ",")
  if (entries === undefined) return false

  return entries.every((entry) => {
    const keyValue = splitKeyValue(entry)
    return (
      keyValue !== undefined &&
      objectKeyName(keyValue[0]) !== undefined &&
      isSafeGenui0ScalarExpression(keyValue[1])
    )
  })
}

/** Return whether an ordinary local expression belongs to the genui/0 subset. */
export const isSafeGenui0SimpleExpression = (value: string): boolean =>
  value.length <= 1_200 &&
  (isSafeGenui0ScalarExpression(value) || isSafeGenui0ObjectExpression(value))

/** Return whether a data-bind expression belongs to the genui/0 subset. */
export const isSafeGenui0BindingExpression = (value: string): boolean => {
  const source = value.trim()
  return source.length <= 1_200 && (isGenui0SignalName(source) || isGenui0SignalPath(source))
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
  return objectKeyName(key) === "target" &&
    targetValue !== undefined &&
    isGenui0SignalName(targetValue)
    ? targetValue
    : undefined
}

/** Parse a v0 @capability action only when its input and target syntax are in the dialect. */
export const parseGenui0CapabilityAction = (value: string): Genui0CapabilityAction | undefined => {
  const source = value.trim()
  const prefix = "@capability("
  if (!source.startsWith(prefix) || !source.endsWith(")")) return undefined

  const args = splitTopLevel(source.slice(prefix.length, -1), ",")
  if (args === undefined || (args.length !== 2 && args.length !== 3)) return undefined

  const capability = stringLiteralValue(args[0])
  const inputExpression = args[1]

  if (
    capability === undefined ||
    inputExpression === undefined ||
    !isGenui0CapabilityName(capability) ||
    !isSafeGenui0ObjectExpression(inputExpression)
  ) {
    return undefined
  }

  if (args[2] === undefined) return { capability, inputExpression }

  const target = parseTargetOptions(args[2])
  return target === undefined ? undefined : { capability, inputExpression, target }
}

const camelCaseWords = (words: readonly string[]): string => {
  const [first, ...rest] = words
  if (first === undefined) return "capability"

  return [
    first.toLowerCase(),
    ...rest.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`),
  ].join("")
}

/** Convert a capability name into the default genui/0 result signal target. */
export const defaultGenui0ResultTarget = (capability: string): string => {
  const words = capability.split(/[._-]+/).filter((part) => part.length > 0)
  const target = camelCaseWords(words)
  return isGenui0SignalName(target) ? target : "capability"
}

/** Keep model-authored result target names inside the genui/0 signal-name subset. */
export const normalizeGenui0ResultTarget = (
  target: string | undefined,
  capability: string,
): string =>
  target !== undefined && isGenui0SignalName(target)
    ? target
    : defaultGenui0ResultTarget(capability)

const scriptString = (value: string): string => JSON.stringify(value)

/** Build the sandbox-language parser source used by the injected genui/0 bridge. */
export const genui0SandboxLanguageScript = (): string => `
  const genui0Invalid = Symbol("genui0.invalid");
  const genui0CapabilityNamePattern = new RegExp(${scriptString(`^${capabilityNamePatternSource}$`)}, "i");
  const genui0BareIdentifierPattern = new RegExp(${scriptString(`^${bareIdentifierPatternSource}$`)});
  const genui0SignalPathPattern = new RegExp(${scriptString(`^${signalPathPatternSource}$`)});
  const genui0NumberLiteralPattern = new RegExp(${scriptString(`^${numberLiteralPatternSource}$`)});
  const genui0StringLiteralPattern = new RegExp(${scriptString(`^${stringLiteralPatternSource}$`)});

  const genui0SplitTopLevel = (source, separator) => {
    const parts = [];
    let quote;
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\\\") return undefined;

      if (quote !== undefined) {
        if (character === quote) quote = undefined;
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === "(" || character === "[" || character === "{") {
        depth += 1;
        continue;
      }

      if (character === ")" || character === "]" || character === "}") {
        depth -= 1;
        if (depth < 0) return undefined;
        continue;
      }

      if (character === separator && depth === 0) {
        parts.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }

    if (quote !== undefined || depth !== 0) return undefined;
    parts.push(source.slice(start).trim());
    return parts.every((part) => part.length > 0) ? parts : undefined;
  };

  const genui0ParseStringLiteral = (source) =>
    genui0StringLiteralPattern.test(source.trim()) ? source.trim().slice(1, -1) : genui0Invalid;

  const genui0ParseObjectKey = (source) => {
    const key = source.trim();
    if (genui0BareIdentifierPattern.test(key)) return key;
    const literal = genui0ParseStringLiteral(key);
    return literal !== genui0Invalid && genui0BareIdentifierPattern.test(literal)
      ? literal
      : genui0Invalid;
  };

  const genui0ParseScalarExpression = (source, readSignal) => {
    const value = source.trim();
    if (genui0StringLiteralPattern.test(value)) return value.slice(1, -1);
    if (genui0NumberLiteralPattern.test(value)) return Number(value);
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (genui0SignalPathPattern.test(value)) return readSignal(value);
    return genui0Invalid;
  };

  const genui0ParseObjectLiteral = (source, readSignal) => {
    const value = source.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) return genui0Invalid;

    const body = value.slice(1, -1).trim();
    if (body.length === 0) return {};

    const entries = genui0SplitTopLevel(body, ",");
    if (entries === undefined) return genui0Invalid;

    const output = {};
    for (const entry of entries) {
      const keyValue = genui0SplitTopLevel(entry, ":");
      if (keyValue === undefined || keyValue.length !== 2) return genui0Invalid;

      const key = genui0ParseObjectKey(keyValue[0]);
      if (key === genui0Invalid) return genui0Invalid;

      const parsedValue = genui0ParseScalarExpression(keyValue[1], readSignal);
      if (parsedValue === genui0Invalid) return genui0Invalid;
      output[key] = parsedValue;
    }

    return output;
  };

  const genui0ParseTargetOption = (source) => {
    const value = source.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) return genui0Invalid;

    const body = value.slice(1, -1).trim();
    if (body.length === 0) return undefined;

    const entries = genui0SplitTopLevel(body, ",");
    if (entries === undefined || entries.length !== 1) return genui0Invalid;

    const keyValue = genui0SplitTopLevel(entries[0], ":");
    if (keyValue === undefined || keyValue.length !== 2) return genui0Invalid;

    const key = genui0ParseObjectKey(keyValue[0]);
    const target = genui0ParseStringLiteral(keyValue[1]);
    return key === "target" && target !== genui0Invalid && genui0BareIdentifierPattern.test(target)
      ? target
      : genui0Invalid;
  };

  const parseGenui0CapabilityExpression = (expression, readSignal) => {
    const source = expression.trim();
    const prefix = "@capability(";
    if (!source.startsWith(prefix) || !source.endsWith(")")) return undefined;

    const args = genui0SplitTopLevel(source.slice(prefix.length, -1), ",");
    if (args === undefined || (args.length !== 2 && args.length !== 3)) return undefined;

    const capability = genui0ParseStringLiteral(args[0]);
    if (capability === genui0Invalid || !genui0CapabilityNamePattern.test(capability)) return undefined;

    const input = genui0ParseObjectLiteral(args[1], readSignal);
    if (input === genui0Invalid) return undefined;

    const target = args[2] === undefined ? undefined : genui0ParseTargetOption(args[2]);
    if (target === genui0Invalid) return undefined;

    return { capability, input, target };
  };
`
