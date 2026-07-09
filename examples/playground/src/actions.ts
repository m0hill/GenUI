import { action } from "@genui/genui"

export type OrderStatus = "pending" | "processing" | "shipped"

export interface Order {
  readonly id: string
  readonly customer: string
  readonly status: OrderStatus
  readonly total: number
}

interface SearchInput {
  readonly query: string
  readonly status?: OrderStatus
}

interface OrderIdInput {
  readonly id: string
}

interface UpdateStatusInput extends OrderIdInput {
  readonly status: OrderStatus
}

const initialOrders: readonly Order[] = [
  { id: "ord-1001", customer: "Aster Labs", status: "processing", total: 148 },
  { id: "ord-1002", customer: "Northwind Studio", status: "pending", total: 86 },
  { id: "ord-1003", customer: "Kite & Co.", status: "shipped", total: 240 },
]

let orders: Order[] = []

export const resetDemoOrders = (): void => {
  orders = initialOrders.map((order) => ({ ...order }))
}

resetDemoOrders()

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key))

const issue = (message: string) => ({ issues: [{ message }] })

const standardSchema = <Output>(validate: (value: unknown) => Output | undefined) => ({
  "~standard": {
    version: 1 as const,
    vendor: "genui-playground",
    validate(value: unknown) {
      const output = validate(value)
      return output === undefined
        ? issue("Input does not match the action schema.")
        : { value: output }
    },
  },
})

const orderStatus = (value: unknown): OrderStatus | undefined =>
  value === "pending" || value === "processing" || value === "shipped" ? value : undefined

const searchInput = standardSchema<SearchInput>((value) => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["query", "status"])) return undefined
  const query = value.query === undefined ? "" : value.query
  if (typeof query !== "string") return undefined
  if (value.status === undefined) return { query: query.trim() }
  const status = orderStatus(value.status)
  return status === undefined ? undefined : { query: query.trim(), status }
})

const orderIdInput = standardSchema<OrderIdInput>((value) =>
  isRecord(value) &&
  hasOnlyKeys(value, ["id"]) &&
  typeof value.id === "string" &&
  value.id.length > 0
    ? { id: value.id }
    : undefined,
)

const updateStatusInput = standardSchema<UpdateStatusInput>((value) => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "status"]) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    return undefined
  }
  const status = orderStatus(value.status)
  return status === undefined ? undefined : { id: value.id, status }
})

const emptyInput = standardSchema<Readonly<Record<string, never>>>((value) =>
  isRecord(value) && Object.keys(value).length === 0 ? {} : undefined,
)

const parseOrderOutput = (value: unknown): Order | undefined => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.customer !== "string" ||
    typeof value.total !== "number"
  ) {
    return undefined
  }
  const status = orderStatus(value.status)
  return status === undefined
    ? undefined
    : { id: value.id, customer: value.customer, status, total: value.total }
}

const orderOutput = standardSchema(parseOrderOutput)

const ordersOutput = standardSchema<{ readonly orders: readonly Order[] }>((value) => {
  if (!isRecord(value) || !Array.isArray(value.orders)) return undefined
  const parsed: Order[] = []
  for (const valueOrder of value.orders) {
    const order = parseOrderOutput(valueOrder)
    if (order === undefined) return undefined
    parsed.push(order)
  }
  return { orders: parsed }
})

const orderSchema = {
  type: "object",
  required: ["id", "customer", "status", "total"],
  properties: {
    id: { type: "string" },
    customer: { type: "string" },
    status: { enum: ["pending", "processing", "shipped"] },
    total: { type: "number" },
  },
  additionalProperties: false,
} as const

const findOrder = (id: string): Order => {
  const order = orders.find((candidate) => candidate.id === id)
  if (order === undefined) throw new Error(`Unknown order: ${id}`)
  return order
}

export const demoActions = [
  action({
    name: "orders.search",
    description: "Search orders by customer, order ID, or status.",
    effect: "read",
    input: searchInput,
    inputJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { enum: ["pending", "processing", "shipped"] },
      },
      additionalProperties: false,
    },
    output: ordersOutput,
    outputJsonSchema: {
      type: "object",
      required: ["orders"],
      properties: { orders: { type: "array", items: orderSchema } },
      additionalProperties: false,
    },
    execute: (_context: unknown, input: SearchInput) => {
      const query = input.query.toLowerCase()
      return {
        orders: orders.filter(
          (order) =>
            (input.status === undefined || order.status === input.status) &&
            (query.length === 0 ||
              order.id.toLowerCase().includes(query) ||
              order.customer.toLowerCase().includes(query)),
        ),
      }
    },
  }),
  action({
    name: "orders.get",
    description: "Get one order by ID.",
    effect: "read",
    input: orderIdInput,
    inputJsonSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
    output: orderOutput,
    outputJsonSchema: orderSchema,
    execute: (_context: unknown, input: OrderIdInput) => ({ ...findOrder(input.id) }),
  }),
  action({
    name: "orders.update_status",
    description: "Change an order's fulfillment status.",
    effect: "write",
    intent: "Change order {input.id} to {input.status}",
    input: updateStatusInput,
    inputJsonSchema: {
      type: "object",
      required: ["id", "status"],
      properties: {
        id: { type: "string" },
        status: { enum: ["pending", "processing", "shipped"] },
      },
      additionalProperties: false,
    },
    output: orderOutput,
    outputJsonSchema: orderSchema,
    execute: (_context: unknown, input: UpdateStatusInput) => {
      const current = findOrder(input.id)
      const updated = { ...current, status: input.status }
      orders = orders.map((order) => (order.id === input.id ? updated : order))
      return updated
    },
  }),
  action({
    name: "orders.export_private",
    description: "Export private customer contact data.",
    effect: "read",
    confidentiality: "sensitive",
    input: emptyInput,
    inputJsonSchema: { type: "object", additionalProperties: false },
    execute: () => ({ contacts: ["private@example.test"] }),
  }),
] as const

export const demoActionNames = demoActions.map((definition) => definition.name)
