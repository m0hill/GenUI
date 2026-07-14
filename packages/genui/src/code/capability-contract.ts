import type { Action, JsonSchema, Subscription } from "../protocol/index.js"

interface SchemaDeclaration {
  readonly text: string
  readonly fallback?: { readonly name: string; readonly schema: JsonSchema }
}

const annotationKeys = new Set([
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
])

const constraintKeys = [
  "$id",
  "$schema",
  "default",
  "deprecated",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "readOnly",
  "title",
  "uniqueItems",
  "writeOnly",
] as const

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasOnlyKeys = (
  schema: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean => {
  const allowed = new Set([...annotationKeys, ...keys])
  return Object.keys(schema).every((key) => allowed.has(key))
}

const literal = (value: unknown): string | undefined => {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

const propertyName = (name: string): string =>
  /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name)

const annotateType = (type: string, schema: Readonly<Record<string, unknown>>): string => {
  const constraints: string[] = []
  if (typeof schema.description === "string" && schema.description.trim().length > 0) {
    constraints.push(`description: ${schema.description.trim()}`)
  }
  if (schema.type === "integer") constraints.push("@integer")
  for (const key of constraintKeys) {
    const value = schema[key]
    if (value === undefined) continue
    const encoded = JSON.stringify(value)
    if (encoded !== undefined) constraints.push(`@${key} ${encoded}`)
  }
  if (schema.additionalProperties === false) {
    constraints.push("additional properties are not allowed")
  }
  if (constraints.length === 0) return type
  return `${type} /* ${constraints.join("; ").replaceAll("*/", "*\\/")} */`
}

const isDiscriminatedOneOf = (branches: readonly unknown[]): boolean => {
  if (branches.length < 2 || !branches.every(isRecord)) return false
  const objects = branches.filter(isRecord)
  const firstProperties = objects[0]?.properties
  if (!isRecord(firstProperties)) return false

  for (const name of Object.keys(firstProperties)) {
    const values = new Set<string>()
    let discriminates = true
    for (const branch of objects) {
      if (branch.type !== "object" || !Array.isArray(branch.required)) {
        discriminates = false
        break
      }
      if (!branch.required.includes(name) || !isRecord(branch.properties)) {
        discriminates = false
        break
      }
      const property = branch.properties[name]
      if (!isRecord(property)) {
        discriminates = false
        break
      }
      const value = literal(property.const)
      if (value === undefined || values.has(value)) {
        discriminates = false
        break
      }
      values.add(value)
    }
    if (discriminates) return true
  }
  return false
}

const renderSchema = (value: unknown, indent = ""): string | undefined => {
  if (value === true) return "unknown"
  if (value === false) return "never"
  if (!isRecord(value)) return undefined

  if (Object.hasOwn(value, "enum")) {
    if (!hasOnlyKeys(value, ["enum", "type"]) || !Array.isArray(value.enum)) return undefined
    const members = value.enum.map(literal)
    return members.length > 0 && members.every((member) => member !== undefined)
      ? annotateType(members.join(" | "), value)
      : undefined
  }

  if (Object.hasOwn(value, "const")) {
    if (!hasOnlyKeys(value, ["const", "type"])) return undefined
    const type = literal(value.const)
    return type === undefined ? undefined : annotateType(type, value)
  }

  if (Object.hasOwn(value, "oneOf")) {
    if (!hasOnlyKeys(value, ["oneOf"]) || !Array.isArray(value.oneOf)) return undefined
    if (!isDiscriminatedOneOf(value.oneOf)) return undefined
    const members = value.oneOf.map((member) => renderSchema(member, indent))
    return members.length > 0 && members.every((member) => member !== undefined)
      ? annotateType(members.map((member) => `(${member})`).join(" | "), value)
      : undefined
  }

  if (Object.hasOwn(value, "anyOf")) {
    if (!hasOnlyKeys(value, ["anyOf"]) || !Array.isArray(value.anyOf)) return undefined
    const members = value.anyOf.map((member) => renderSchema(member, indent))
    return members.length > 0 && members.every((member) => member !== undefined)
      ? annotateType(members.map((member) => `(${member})`).join(" | "), value)
      : undefined
  }

  if (value.type === undefined && Object.keys(value).every((key) => annotationKeys.has(key))) {
    return annotateType("unknown", value)
  }
  if (typeof value.type !== "string") return undefined

  if (value.type === "string") {
    return hasOnlyKeys(value, ["format", "maxLength", "minLength", "pattern", "type"])
      ? annotateType("string", value)
      : undefined
  }
  if (value.type === "number" || value.type === "integer") {
    return hasOnlyKeys(value, [
      "exclusiveMaximum",
      "exclusiveMinimum",
      "maximum",
      "minimum",
      "multipleOf",
      "type",
    ])
      ? annotateType("number", value)
      : undefined
  }
  if (value.type === "boolean") {
    return hasOnlyKeys(value, ["type"]) ? annotateType("boolean", value) : undefined
  }
  if (value.type === "null") {
    return hasOnlyKeys(value, ["type"]) ? annotateType("null", value) : undefined
  }

  if (value.type === "array") {
    if (!hasOnlyKeys(value, ["items", "maxItems", "minItems", "type", "uniqueItems"])) {
      return undefined
    }
    const item = value.items === undefined ? "unknown" : renderSchema(value.items, indent)
    return item === undefined ? undefined : annotateType(`ReadonlyArray<${item}>`, value)
  }

  if (value.type !== "object") return undefined
  if (
    !hasOnlyKeys(value, [
      "additionalProperties",
      "maxProperties",
      "minProperties",
      "properties",
      "required",
      "type",
    ])
  ) {
    return undefined
  }
  if (
    value.additionalProperties !== undefined &&
    value.additionalProperties !== false &&
    value.additionalProperties !== true
  ) {
    return undefined
  }
  if (value.properties !== undefined && !isRecord(value.properties)) return undefined
  if (value.required !== undefined && !Array.isArray(value.required)) return undefined

  const properties = value.properties ?? {}
  const required = new Set<string>()
  for (const name of value.required ?? []) {
    if (typeof name !== "string" || !Object.hasOwn(properties, name)) return undefined
    required.add(name)
  }
  const propertyIndent = `${indent}  `
  const members: string[] = []
  for (const [name, schema] of Object.entries(properties)) {
    const type = renderSchema(schema, propertyIndent)
    if (type === undefined || !isRecord(schema)) return undefined
    members.push(`${propertyIndent}${propertyName(name)}${required.has(name) ? "" : "?"}: ${type}`)
  }

  let objectType =
    members.length === 0
      ? value.additionalProperties === false
        ? "Record<string, never>"
        : "Record<string, unknown>"
      : `{\n${members.join("\n")}\n${indent}}`
  if (members.length > 0 && value.additionalProperties !== false) {
    objectType = `${objectType} & Record<string, unknown>`
  }
  return annotateType(objectType, value)
}

const declaration = (name: string, schema: JsonSchema | undefined): SchemaDeclaration => {
  if (schema === undefined) return { text: `type ${name} = unknown` }
  const type = renderSchema(schema)
  if (type === undefined) {
    return {
      text: `type ${name} = unknown`,
      fallback: { name, schema },
    }
  }
  return {
    text: `type ${name} = ${type}`,
  }
}

const typeBase = (name: string): string =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join("")

const documentation = (lines: readonly string[], indent: string): string => {
  const escaped = lines.map((line) => line.replaceAll("*/", "*\\/"))
  return escaped.length === 1
    ? `${indent}/** ${escaped[0]} */`
    : [`${indent}/**`, ...escaped.map((line) => `${indent} * ${line}`), `${indent} */`].join("\n")
}

/** Render selected guest capabilities without changing their authoritative JSON Schemas. */
export const codeCapabilityContract = (
  actions: readonly Action[],
  subscriptions: readonly Subscription[],
): string => {
  if (actions.length === 0 && subscriptions.length === 0) {
    return "# Generated-interface capability contract\n\nNo actions or subscriptions are selected."
  }

  const usedTypeBases = new Map<string, number>()
  const nextTypeBase = (name: string): string => {
    const base = typeBase(name)
    const count = (usedTypeBases.get(base) ?? 0) + 1
    usedTypeBases.set(base, count)
    return count === 1 ? base : `${base}${count}`
  }
  const declarations: SchemaDeclaration[] = []
  const methods: string[] = []

  for (const action of actions) {
    const base = nextTypeBase(action.name)
    const inputName = `${base}Input`
    const outputName = `${base}Output`
    declarations.push(declaration(inputName, action.inputSchema))
    declarations.push(declaration(outputName, action.outputSchema))
    methods.push(
      [
        documentation(
          [
            action.description,
            `Effect: ${action.effect}. Requires approval: ${String(action.requiresApproval)}.`,
            ...(action.intent === undefined ? [] : [`Approval intent: ${action.intent}`]),
          ],
          "  ",
        ),
        `  call(name: ${JSON.stringify(action.name)}, input: ${inputName}): Promise<${outputName}>`,
      ].join("\n"),
    )
  }

  for (const subscription of subscriptions) {
    const base = nextTypeBase(subscription.name)
    const inputName = `${base}Input`
    const eventName = `${base}Event`
    declarations.push(declaration(inputName, subscription.inputSchema))
    declarations.push(declaration(eventName, subscription.eventSchema))
    methods.push(
      [
        documentation(
          [
            subscription.description,
            `Read-only. Maximum event size: ${subscription.maxEventBytes} bytes.`,
          ],
          "  ",
        ),
        `  subscribe(name: ${JSON.stringify(subscription.name)}, input: ${inputName}, handler: (event: ${eventName}) => void | Promise<void>): Promise<GenuiSubscriptionHandle>`,
      ].join("\n"),
    )
  }

  const fallbacks = declarations.flatMap((item) =>
    item.fallback === undefined ? [] : [item.fallback],
  )
  return [
    "# Generated-interface capability contract",
    "",
    "Use only these selected capabilities through `window.genui`.",
    "",
    "```ts",
    ...declarations.map((item) => item.text),
    "",
    "interface Genui {",
    methods.join("\n\n"),
    "}",
    "```",
    ...(fallbacks.length === 0
      ? []
      : [
          "",
          "## Exact JSON Schema fallbacks",
          "",
          "The declarations use `unknown` where TypeScript cannot represent the complete contract.",
          ...fallbacks.flatMap((fallback) => [
            "",
            `Exact JSON Schema for ${fallback.name}:`,
            "```json",
            JSON.stringify(fallback.schema),
            "```",
          ]),
        ]),
  ].join("\n")
}
