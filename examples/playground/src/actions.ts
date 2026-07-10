import { action } from "genui"
import { parseRecord } from "./playground-codecs.js"

const orderStatuses = ["pending", "processing", "shipped"] as const
type OrderStatus = (typeof orderStatuses)[number]

interface Order {
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

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key))

const standardSchema = <Output>(validate: (value: unknown) => Output | undefined) => ({
  "~standard": {
    version: 1 as const,
    vendor: "genui-playground",
    validate(value: unknown) {
      const output = validate(value)
      return output === undefined
        ? { issues: [{ message: "Input does not match the action schema." }] }
        : { value: output }
    },
  },
})

const parseOrderStatus = (value: unknown): OrderStatus | undefined =>
  orderStatuses.find((status) => status === value)

const searchInput = standardSchema<SearchInput>((value) => {
  const record = parseRecord(value)
  if (record === undefined || !hasOnlyKeys(record, ["query", "status"])) return undefined
  const query = record.query === undefined ? "" : record.query
  if (typeof query !== "string") return undefined
  if (record.status === undefined) return { query: query.trim() }
  const status = parseOrderStatus(record.status)
  return status === undefined ? undefined : { query: query.trim(), status }
})

const orderIdInput = standardSchema<OrderIdInput>((value) => {
  const record = parseRecord(value)
  return record !== undefined &&
    hasOnlyKeys(record, ["id"]) &&
    typeof record.id === "string" &&
    record.id.length > 0
    ? { id: record.id }
    : undefined
})

const updateStatusInput = standardSchema<UpdateStatusInput>((value) => {
  const record = parseRecord(value)
  if (
    record === undefined ||
    !hasOnlyKeys(record, ["id", "status"]) ||
    typeof record.id !== "string" ||
    record.id.length === 0
  ) {
    return undefined
  }
  const status = parseOrderStatus(record.status)
  return status === undefined ? undefined : { id: record.id, status }
})

const emptyInput = standardSchema<Readonly<Record<string, never>>>((value) => {
  const record = parseRecord(value)
  return record !== undefined && Object.keys(record).length === 0 ? {} : undefined
})

const parseOrderOutput = (value: unknown): Order | undefined => {
  const record = parseRecord(value)
  if (
    record === undefined ||
    typeof record.id !== "string" ||
    typeof record.customer !== "string" ||
    typeof record.total !== "number"
  ) {
    return undefined
  }
  const status = parseOrderStatus(record.status)
  return status === undefined
    ? undefined
    : { id: record.id, customer: record.customer, status, total: record.total }
}

const orderOutput = standardSchema(parseOrderOutput)

const ordersOutput = standardSchema<{ readonly orders: readonly Order[] }>((value) => {
  const record = parseRecord(value)
  if (record === undefined || !Array.isArray(record.orders)) return undefined
  const parsed: Order[] = []
  for (const valueOrder of record.orders) {
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
    status: { enum: [...orderStatuses] },
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
        status: { enum: [...orderStatuses] },
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
        status: { enum: [...orderStatuses] },
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
